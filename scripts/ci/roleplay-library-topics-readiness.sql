-- Metadata only: no application rows, credentials, role names or mutations.
WITH target AS (
  SELECT c.oid, c.relowner, c.relacl, c.relrowsecurity, c.relkind
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='roleplay_library_topics'
), external_roles AS (
  SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
), required_columns(name, type_name) AS (
  VALUES ('fingerprint','character varying(64)'), ('topic','character varying(40)'),
         ('subtopic','character varying(40)'), ('updated_at','timestamp with time zone')
)
SELECT json_build_object(
  'tableExists', COALESCE(t.relkind='r',false),
  'rlsEnabled', COALESCE(t.relrowsecurity,false),
  'columnsMatch', t.oid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM required_columns r WHERE NOT EXISTS (
      SELECT 1 FROM pg_attribute a WHERE a.attrelid=t.oid AND a.attname=r.name
        AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull
        AND format_type(a.atttypid,a.atttypmod)=r.type_name
    )
  ),
  'fingerprintPrimaryKey', EXISTS (
    SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid=k.conrelid
      AND a.attname='fingerprint' AND NOT a.attisdropped
    WHERE k.conrelid=t.oid AND k.contype='p' AND k.conkey=ARRAY[a.attnum]
  ),
  'externalRolesPresent', (SELECT count(*)=3 FROM external_roles),
  'externalAccessDenied', t.oid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM external_roles r
    WHERE has_table_privilege(r.oid,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(r.oid,t.oid,'SELECT,INSERT,UPDATE,REFERENCES')
  ) AND NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(t.relacl,acldefault('r',t.relowner))) a WHERE a.grantee=0
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a
      WHERE c.attrelid=t.oid AND c.attnum>0 AND NOT c.attisdropped AND a.grantee=0
  ),
  'serverDmlGranted', COALESCE(has_schema_privilege(current_user,'public','USAGE')
    AND has_table_privilege(current_user,t.oid,'SELECT')
    AND has_table_privilege(current_user,t.oid,'INSERT')
    AND has_table_privilege(current_user,t.oid,'UPDATE')
    AND has_table_privilege(current_user,t.oid,'DELETE'),false),
  'rlsActiveForServer', COALESCE(row_security_active(t.oid),false)
) AS result
FROM (SELECT 1) seed LEFT JOIN target t ON true;
