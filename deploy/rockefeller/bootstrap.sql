-- Apply once to a fresh dedicated cluster as postgres. No passwords or trust
-- auth: pg_hba.conf binds these logins to the operator/web kernel UIDs.
CREATE ROLE schools_runtime LOGIN NOINHERIT;
CREATE ROLE schools_publisher LOGIN NOINHERIT;
CREATE ROLE research_owner LOGIN NOINHERIT;
CREATE ROLE research_reader LOGIN NOINHERIT;
CREATE DATABASE openvalley_schools;
CREATE DATABASE openvalley_research OWNER research_owner;
REVOKE ALL ON DATABASE openvalley_schools FROM PUBLIC;
GRANT CONNECT ON DATABASE openvalley_schools TO schools_runtime,schools_publisher;
REVOKE ALL ON DATABASE openvalley_research FROM PUBLIC;
GRANT CONNECT ON DATABASE openvalley_research TO research_reader;
