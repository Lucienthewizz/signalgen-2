"""Request models for the legacy and screen-style backtest APIs."""

from typing import List, Optional

from pydantic import BaseModel, Field


class BacktestRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    mode: str = Field(..., pattern="^(scalping|swing)$")
    rule_id: int = Field(..., gt=0)
    symbols: List[str] = Field(..., min_length=1, max_length=50)
    timeframe: str
    start_date: str
    end_date: str
    data_source: str = Field(..., pattern="^(ibkr|yahoo)$")


class ManualBacktestEntry(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=20)
    entry_time: str
    signal_type: Optional[str] = Field(default="BUY", pattern="^(BUY|SELL)$")
    entry_price: Optional[float] = Field(None, gt=0)


class BacktestScreenRequest(BaseModel):
    mode: str = Field(..., pattern="^(rule|manual)$")
    timeframe: str = Field(..., pattern="^(1m|5m|15m|1h|4h|1d)$")
    n_steps: int = Field(..., ge=1, le=100)
    data_source: str = Field(..., pattern="^(ibkr|yahoo)$")
    entry_price_basis: str = Field(default="close", pattern="^(open|high|low|close)$")
    exit_price_basis: str = Field(default="close", pattern="^(open|high|low|close)$")
    pl_basis: Optional[str] = Field(default=None, pattern="^(open|high|low|close)$")
    rule_id: Optional[int] = Field(None, gt=0)
    start_at: Optional[str] = None
    end_at: Optional[str] = None
    symbols: Optional[List[str]] = Field(None, max_length=200)
    manual_entries: Optional[List[ManualBacktestEntry]] = Field(None, max_length=2000)
    initial_capital: float = Field(default=10000.0, gt=0)
    position_sizing: str = Field(default="percent_equity", pattern="^(percent_equity|fixed_amount)$")
    position_size: float = Field(default=100.0, gt=0)
    commission_pct: float = Field(default=0.0, ge=0, le=10)
    slippage_pct: float = Field(default=0.0, ge=0, le=10)
    exit_strategy: str = Field(default="holding_period", pattern="^(holding_period|target_stop|exit_signal)$")
    exit_rule_id: Optional[int] = Field(None, gt=0)
    take_profit_pct: Optional[float] = Field(None, gt=0, le=1000)
    stop_loss_pct: Optional[float] = Field(None, gt=0, le=100)
