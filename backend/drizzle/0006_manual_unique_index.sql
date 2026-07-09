-- Custom SQL migration file, put your code below! --
CREATE UNIQUE INDEX entries_owner_parent_name_active_key
ON entries (
    owner_id,
    parent_id,
    lower(name)
)
NULLS NOT DISTINCT
WHERE deleted_at IS NULL;