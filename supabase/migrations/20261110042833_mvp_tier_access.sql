-- Deploy the policy-aware Go API BEFORE applying this feature mapping.
-- Preserve paid Analyst backtest rights until the already-granted period ends.
with previous as (
 select s.user_id,s.current_period_end,to_jsonb(g) as before_json
 from signalgen.subscriptions s
 left join signalgen.feature_grants g on g.user_id=s.user_id and g.feature='backtest'
 where s.plan_code='analyst' and s.status in ('active','trialing')
 and s.current_period_start<=now() and s.current_period_end>now()
 and not exists(select 1 from signalgen.feature_grants current_grant
   where current_grant.user_id=s.user_id and current_grant.feature='backtest'
   and current_grant.revoked_at is null and current_grant.valid_until>=s.current_period_end)
), preserved as (
 insert into signalgen.feature_grants(user_id,feature,valid_until,reason,revoked_at,updated_at)
 select user_id,'backtest',current_period_end,'MVP tier migration: preserve existing Analyst backtest period',null,now() from previous
 on conflict(user_id,feature) do update set
 valid_until=case when signalgen.feature_grants.revoked_at is null
   then greatest(signalgen.feature_grants.valid_until,excluded.valid_until)
   else excluded.valid_until end,
 reason=excluded.reason,revoked_at=null,updated_at=now()
 returning *
)
insert into signalgen.audit_events(actor,action,target_user_id,feature,reason,request_id,before_json,after_json)
select 'migration:mvp-tier-access','feature.grant',p.user_id,'backtest',p.reason,
 'migration:20261110035906',previous.before_json,to_jsonb(p)
from preserved p join previous on previous.user_id=p.user_id;

update signalgen.subscription_plans set description=case code
 when 'free' then 'Daily screening with the system rule, up to 3 stocks and 1 universe.'
 when 'analyst' then 'Screening with personal rules, up to 10 stocks; historical analysis preview.'
 when 'pro' then 'Screening and historical analysis, with higher saved-resource limits.' end
where code in ('free','analyst','pro');

delete from signalgen.subscription_plan_features where plan_code='analyst' and feature='backtest';
insert into signalgen.subscription_plan_features(plan_code,feature)
values ('free','screener'),('analyst','screener'),('pro','screener'),('pro','backtest')
on conflict do nothing;
-- Rollback: remove Free mapping before rolling back Go. Do not delete grants,
-- subscriptions, rule/universe/journal data, or change existing Pro periods.
