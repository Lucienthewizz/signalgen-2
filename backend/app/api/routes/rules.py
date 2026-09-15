"""Trading-rule HTTP endpoints."""

import logging
from typing import Callable, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse

from app.auth.dependencies import get_current_user
from app.core.rule_engine import RuleValidationError
from app.schemas.rules import RuleCreate, RuleUpdate
from app.services.rule_service import RuleNotFoundError, RuleService


logger = logging.getLogger(__name__)


def create_rules_router(
    rule_service: RuleService,
    engine_is_running: Callable[[], bool],
) -> APIRouter:
    """Build the rules router using application-owned dependencies."""
    router = APIRouter(prefix="/api/rules", tags=["rules"])

    @router.get("", response_model=List[Dict])
    def get_all_rules(current_user=Depends(get_current_user)):
        try:
            return JSONResponse(
                content=rule_service.list_for_user(str(current_user.id))
            )
        except Exception as error:
            logger.error("Error getting rules: %s", error)
            raise HTTPException(status_code=500, detail="Internal server error")

    @router.get("/schema", response_model=Dict)
    def get_rule_schema():
        try:
            return JSONResponse(content=rule_service.get_schema())
        except Exception as error:
            logger.error("Error getting rule schema: %s", error)
            raise HTTPException(status_code=500, detail="Internal server error")

    @router.get("/{rule_id}", response_model=Dict)
    def get_rule(rule_id: int, current_user=Depends(get_current_user)):
        try:
            rule = rule_service.get_for_user(rule_id, str(current_user.id))
            return JSONResponse(content=rule)
        except RuleNotFoundError:
            raise HTTPException(status_code=404, detail="Rule not found")
        except HTTPException:
            raise
        except Exception as error:
            logger.error("Error getting rule %s: %s", rule_id, error)
            raise HTTPException(status_code=500, detail="Internal server error")

    @router.post("", response_model=Dict)
    def create_rule(rule: RuleCreate, current_user=Depends(get_current_user)):
        try:
            created_rule = rule_service.create_for_user(
                name=rule.name,
                definition=rule.definition,
                user_id=str(current_user.id),
            )
            return JSONResponse(content=created_rule, status_code=201)
        except RuleValidationError as error:
            raise HTTPException(status_code=422, detail=str(error))
        except HTTPException:
            raise
        except Exception as error:
            logger.error("Error creating rule: %s", error)
            raise HTTPException(status_code=500, detail="Internal server error")

    @router.put("/{rule_id}", response_model=Dict)
    def update_rule(
        rule_id: int,
        rule: RuleUpdate,
        current_user=Depends(get_current_user),
    ):
        try:
            updated_rule = rule_service.update_for_user(
                rule_id=rule_id,
                user_id=str(current_user.id),
                name=rule.name,
                definition=rule.definition,
            )
            return JSONResponse(content=updated_rule)
        except RuleNotFoundError:
            raise HTTPException(
                status_code=404,
                detail="Rule not found or is system rule",
            )
        except RuleValidationError as error:
            raise HTTPException(status_code=422, detail=str(error))
        except HTTPException:
            raise
        except Exception as error:
            logger.error("Error updating rule %s: %s", rule_id, error)
            raise HTTPException(status_code=500, detail="Internal server error")

    @router.delete("/{rule_id}")
    def delete_rule(rule_id: int, current_user=Depends(get_current_user)):
        try:
            rule_service.delete_for_user(rule_id, str(current_user.id))
            return {"message": "Rule deleted successfully"}
        except RuleNotFoundError:
            raise HTTPException(
                status_code=404,
                detail="Rule not found or is system rule",
            )
        except HTTPException:
            raise
        except Exception as error:
            logger.error("Error deleting rule %s: %s", rule_id, error)
            raise HTTPException(status_code=500, detail="Internal server error")

    @router.put("/{rule_id}/activate")
    def activate_rule(rule_id: int, current_user=Depends(get_current_user)):
        try:
            if engine_is_running():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Cannot activate rule while engine is running",
                )

            rule_service.get_for_user(rule_id, str(current_user.id))
            return {"message": "Rule activated successfully"}
        except RuleNotFoundError:
            raise HTTPException(status_code=404, detail="Rule not found")
        except HTTPException:
            raise
        except Exception as error:
            logger.error("Error activating rule %s: %s", rule_id, error)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error",
            )

    return router
