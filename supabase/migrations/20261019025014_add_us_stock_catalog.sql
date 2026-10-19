-- Additive expansion: keep every existing IDX row and all ownership/RLS policies.
-- Filename follows the verified cloud migration version returned by Supabase.
-- Initial 20-symbol US catalog, checked against Nasdaq Trader directories
-- nasdaqlisted.txt / otherlisted.txt on 2026-10-19 (not a complete US listing).
alter table signalgen.stock_catalog
  drop constraint stock_catalog_symbol_check,
  drop constraint stock_catalog_exchange_check,
  drop constraint stock_catalog_currency_check;
alter table signalgen.stock_catalog add constraint stock_catalog_market_instrument_check check (
  (exchange='XIDX' and currency='IDR' and symbol ~ '^[A-Z0-9]+[.]JK$') or
  (exchange in ('XNAS','XNYS') and currency='USD' and symbol ~ '^[A-Z][A-Z0-9]{0,9}(-[A-Z])?$')
);

insert into signalgen.stock_catalog(symbol,provider,provider_symbol,name,exchange,currency) values
('AAPL','yahoo_finance','AAPL','Apple Inc.','XNAS','USD'),
('ADBE','yahoo_finance','ADBE','Adobe Inc.','XNAS','USD'),
('AMD','yahoo_finance','AMD','Advanced Micro Devices, Inc.','XNAS','USD'),
('AMZN','yahoo_finance','AMZN','Amazon.com, Inc.','XNAS','USD'),
('AVGO','yahoo_finance','AVGO','Broadcom Inc.','XNAS','USD'),
('BAC','yahoo_finance','BAC','Bank of America Corporation','XNYS','USD'),
('BRK-B','yahoo_finance','BRK-B','Berkshire Hathaway Inc. (Class B)','XNYS','USD'),
('DIS','yahoo_finance','DIS','Walt Disney Company','XNYS','USD'),
('GOOGL','yahoo_finance','GOOGL','Alphabet Inc. (Class A)','XNAS','USD'),
('JPM','yahoo_finance','JPM','JP Morgan Chase & Co.','XNYS','USD'),
('KO','yahoo_finance','KO','Coca-Cola Company','XNYS','USD'),
('MA','yahoo_finance','MA','Mastercard Incorporated','XNYS','USD'),
('META','yahoo_finance','META','Meta Platforms, Inc.','XNAS','USD'),
('MSFT','yahoo_finance','MSFT','Microsoft Corporation','XNAS','USD'),
('NFLX','yahoo_finance','NFLX','Netflix, Inc.','XNAS','USD'),
('NVDA','yahoo_finance','NVDA','NVIDIA Corporation','XNAS','USD'),
('QCOM','yahoo_finance','QCOM','QUALCOMM Incorporated','XNAS','USD'),
('TSLA','yahoo_finance','TSLA','Tesla, Inc.','XNAS','USD'),
('V','yahoo_finance','V','Visa Inc.','XNYS','USD'),
('XOM','yahoo_finance','XOM','ExxonMobil Holdings Corporation','XNYS','USD')
on conflict(symbol) do nothing;
