"""Business logic for trading rules and their ownership."""

from typing import Any, Dict, List, Optional

from app.core.rule_engine import RuleEngine
from app.storage.sqlite_repo import SQLiteRepository


class RuleNotFoundError(Exception):
    """Raised when a rule is unavailable to the current user."""


class RuleService:
    """Coordinate rule validation, persistence, and user authorization."""

    def __init__(self, repository: SQLiteRepository, rule_engine: RuleEngine):
        self.repository = repository
        self.rule_engine = rule_engine

    def list_for_user(self, user_id: str) -> List[Dict]:
        return self.repository.get_rules_for_user(user_id)

    def get_for_user(self, rule_id: int, user_id: str) -> Dict:
        rule = self.repository.get_rule_for_user(rule_id, user_id)
        if rule is None:
            raise RuleNotFoundError
        return rule

    def create_for_user(self, name: str, definition: Dict, user_id: str) -> Dict:
        self._validate(name, definition)
        rule_id = self.repository.create_rule(
            name=name,
            rule_type="custom",
            definition=definition,
            user_id=user_id,
        )
        return self.get_for_user(rule_id, user_id)

    def update_for_user(
        self,
        rule_id: int,
        user_id: str,
        name: Optional[str] = None,
        definition: Optional[Dict] = None,
    ) -> Dict:
        existing_rule = self.get_for_user(rule_id, user_id)
        if existing_rule.get("is_system"):
            raise RuleNotFoundError

        next_name = name if name is not None else existing_rule["name"]
        next_definition = (
            definition if definition is not None else existing_rule["definition"]
        )
        self._validate(
            next_name,
            next_definition,
            rule_id=rule_id,
            rule_type=existing_rule.get("type", "custom"),
        )

        updated = self.repository.update_rule_for_user(
            rule_id=rule_id,
            user_id=user_id,
            name=name,
            definition=definition,
        )
        if not updated:
            raise RuleNotFoundError
        return self.get_for_user(rule_id, user_id)

    def delete_for_user(self, rule_id: int, user_id: str) -> None:
        if not self.repository.delete_rule_for_user(rule_id, user_id):
            raise RuleNotFoundError

    def get_schema(self) -> Dict[str, Any]:
        """Return the rule-builder contract supported by the engine."""
        operand_groups = {
            "Price & Candle": [
                "PRICE", "OPEN", "HIGH", "LOW", "CLOSE",
                "PREV_CLOSE", "PREV_OPEN",
                "OPEN_PREV", "HIGH_PREV", "LOW_PREV", "CLOSE_PREV",
            ],
            "Simple Moving Averages": [
                "MA20", "MA50", "MA100", "MA200",
                "MA20_PREV", "MA50_PREV", "MA100_PREV", "MA200_PREV",
            ],
            "Exponential Moving Averages": [
                "EMA6", "EMA9", "EMA10", "EMA13", "EMA20", "EMA21", "EMA34", "EMA50",
                "EMA6_PREV", "EMA9_PREV", "EMA10_PREV", "EMA13_PREV",
                "EMA20_PREV", "EMA21_PREV", "EMA34_PREV", "EMA50_PREV",
            ],
            "MACD": [
                "MACD", "MACD_SIGNAL", "MACD_HIST",
                "MACD_PREV", "MACD_SIGNAL_PREV", "MACD_HIST_PREV",
            ],
            "RSI": ["RSI14", "RSI14_PREV"],
            "ADX": ["ADX5", "ADX5_PREV"],
            "Bollinger Bands": [
                "BB_UPPER", "BB_MIDDLE", "BB_LOWER", "BB_WIDTH",
                "BB_UPPER_PREV", "BB_MIDDLE_PREV", "BB_LOWER_PREV",
            ],
            "Stochastic Oscillator": [
                "STOCH_K", "STOCH_D", "STOCH_K_PREV", "STOCH_D_PREV",
            ],
            "Ichimoku Cloud": [
                "ICHIMOKU_CONVERSION", "ICHIMOKU_BASE", "ICHIMOKU_A", "ICHIMOKU_B",
                "ICHIMOKU_CONVERSION_PREV", "ICHIMOKU_BASE_PREV",
                "ICHIMOKU_A_PREV", "ICHIMOKU_B_PREV",
            ],
            "Volume": ["VOLUME", "SMA_VOLUME_20"],
            "Calculated Metrics": ["PRICE_EMA20_DIFF_PCT"],
            "Candle Pattern": list(self.rule_engine.CANDLE_PATTERN_DEFINITIONS),
        }
        supported = self.rule_engine.SUPPORTED_OPERANDS
        filtered_groups = {
            group: [operand for operand in operands if operand in supported]
            for group, operands in operand_groups.items()
        }
        quick_operand_groups = {
            group: [
                operand
                for operand in operands
                if not operand.endswith("_PREV") and not operand.startswith("PREV_")
            ]
            for group, operands in filtered_groups.items()
        }
        quick_operands = {
            operand
            for operands in quick_operand_groups.values()
            for operand in operands
        }
        period_bounds = {
            "min": self.rule_engine.MIN_DYNAMIC_PERIOD,
            "max": self.rule_engine.MAX_DYNAMIC_PERIOD,
        }

        return {
            "operand_groups": quick_operand_groups,
            "prev_n_base_operand_groups": quick_operand_groups,
            "operand_labels": {
                operand: definition["label"]
                for operand, definition in self.rule_engine.CANDLE_PATTERN_DEFINITIONS.items()
            },
            "candle_patterns": self.rule_engine.CANDLE_PATTERN_DEFINITIONS,
            "legacy_operands": sorted(supported - quick_operands),
            "operands": sorted(supported),
            "dynamic_operand_templates": [
                {
                    "value": "PRICE_PREV_{n}",
                    "label": "Historical Close Price (legacy)",
                    "parameter": "n",
                    **period_bounds,
                },
                {
                    "value": "{operand}_PREV_{n}",
                    "label": "Previous Value for Any Indicator",
                    "parameter": "n",
                    **period_bounds,
                },
                {
                    "value": "MA{period}",
                    "label": "Simple Moving Average",
                    "parameter": "period",
                    **period_bounds,
                },
                {
                    "value": "EMA{period}",
                    "label": "Exponential Moving Average",
                    "parameter": "period",
                    **period_bounds,
                },
                {
                    "value": "RSI{period}",
                    "label": "Relative Strength Index",
                    "parameter": "period",
                    **period_bounds,
                },
                {
                    "value": "ADX{period}",
                    "label": "Average Directional Index",
                    "parameter": "period",
                    **period_bounds,
                },
                {
                    "value": "SMA_VOLUME_{period}",
                    "label": "Volume SMA",
                    "parameter": "period",
                    **period_bounds,
                },
            ],
            "dynamic_parameter_bounds": period_bounds,
            "operators": [
                operator
                for operator in [">", "<", ">=", "<=", "CROSS_UP", "CROSS_DOWN"]
                if operator in self.rule_engine.SUPPORTED_OPERATORS
            ],
            "logic": sorted(self.rule_engine.SUPPORTED_LOGIC),
            "cross_operators": ["CROSS_UP", "CROSS_DOWN"],
            "crossable_operands": self.rule_engine.get_crossable_operands(),
        }

    def _validate(
        self,
        name: str,
        definition: Dict,
        rule_id: int = 0,
        rule_type: str = "custom",
    ) -> None:
        rule = {
            "id": rule_id,
            "name": name,
            "type": rule_type,
            **definition,
        }
        self.rule_engine.validate_rule(rule)
