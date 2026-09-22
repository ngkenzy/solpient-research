-- Research Factory V1.1 performance cleanup.
-- The existing research_factory_items_stage_idx already covers
-- (research_factory_run_id,status,stage,ordinal).

drop index if exists public.research_factory_items_auto_queue_idx;
