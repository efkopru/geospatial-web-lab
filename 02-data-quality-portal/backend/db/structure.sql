SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: reject_dataset_version_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_dataset_version_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'Approved dataset versions are immutable'; END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ar_internal_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_internal_metadata (
    key character varying NOT NULL,
    value character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: dataset_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dataset_records (
    id bigint NOT NULL,
    dataset_id bigint NOT NULL,
    ordinal integer NOT NULL,
    feature jsonb NOT NULL,
    validation_errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    accepted boolean DEFAULT false NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    geom public.geometry(Geometry,4326),
    CONSTRAINT accepted_geometry_valid CHECK (((NOT accepted) OR ((geom IS NOT NULL) AND public.st_isvalid(geom))))
);


--
-- Name: dataset_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dataset_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dataset_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dataset_records_id_seq OWNED BY public.dataset_records.id;


--
-- Name: dataset_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dataset_versions (
    id bigint NOT NULL,
    dataset_id bigint NOT NULL,
    approved_by_id bigint NOT NULL,
    content jsonb NOT NULL,
    export_json text NOT NULL,
    digest character varying NOT NULL,
    feature_count integer NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: dataset_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dataset_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dataset_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dataset_versions_id_seq OWNED BY public.dataset_versions.id;


--
-- Name: datasets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.datasets (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    name character varying NOT NULL,
    status character varying DEFAULT 'queued'::character varying NOT NULL,
    source_digest character varying NOT NULL,
    source jsonb NOT NULL,
    required_attributes jsonb DEFAULT '["asset_id"]'::jsonb NOT NULL,
    total_count integer DEFAULT 0 NOT NULL,
    processed_count integer DEFAULT 0 NOT NULL,
    valid_count integer DEFAULT 0 NOT NULL,
    invalid_count integer DEFAULT 0 NOT NULL,
    failure_message text,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT dataset_status CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'validating'::character varying, 'ready'::character varying, 'approved'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: datasets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.datasets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: datasets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.datasets_id_seq OWNED BY public.datasets.id;


--
-- Name: login_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_sessions (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    token_digest character varying NOT NULL,
    expires_at timestamp(6) without time zone NOT NULL,
    revoked_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: login_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.login_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: login_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.login_sessions_id_seq OWNED BY public.login_sessions.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    email character varying NOT NULL,
    name character varying NOT NULL,
    password_digest character varying NOT NULL,
    role character varying DEFAULT 'reporter'::character varying NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: dataset_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_records ALTER COLUMN id SET DEFAULT nextval('public.dataset_records_id_seq'::regclass);


--
-- Name: dataset_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_versions ALTER COLUMN id SET DEFAULT nextval('public.dataset_versions_id_seq'::regclass);


--
-- Name: datasets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets ALTER COLUMN id SET DEFAULT nextval('public.datasets_id_seq'::regclass);


--
-- Name: login_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_sessions ALTER COLUMN id SET DEFAULT nextval('public.login_sessions_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: ar_internal_metadata ar_internal_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_internal_metadata
    ADD CONSTRAINT ar_internal_metadata_pkey PRIMARY KEY (key);


--
-- Name: dataset_records dataset_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_records
    ADD CONSTRAINT dataset_records_pkey PRIMARY KEY (id);


--
-- Name: dataset_versions dataset_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_versions
    ADD CONSTRAINT dataset_versions_pkey PRIMARY KEY (id);


--
-- Name: datasets datasets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT datasets_pkey PRIMARY KEY (id);


--
-- Name: login_sessions login_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_sessions
    ADD CONSTRAINT login_sessions_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: dataset_records_geom_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dataset_records_geom_idx ON public.dataset_records USING gist (geom);


--
-- Name: index_dataset_records_on_dataset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_dataset_records_on_dataset_id ON public.dataset_records USING btree (dataset_id);


--
-- Name: index_dataset_records_on_dataset_id_and_accepted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_dataset_records_on_dataset_id_and_accepted ON public.dataset_records USING btree (dataset_id, accepted);


--
-- Name: index_dataset_records_on_dataset_id_and_ordinal; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_dataset_records_on_dataset_id_and_ordinal ON public.dataset_records USING btree (dataset_id, ordinal);


--
-- Name: index_dataset_versions_on_approved_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_dataset_versions_on_approved_by_id ON public.dataset_versions USING btree (approved_by_id);


--
-- Name: index_dataset_versions_on_dataset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_dataset_versions_on_dataset_id ON public.dataset_versions USING btree (dataset_id);


--
-- Name: index_datasets_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_datasets_on_user_id ON public.datasets USING btree (user_id);


--
-- Name: index_datasets_on_user_id_and_source_digest; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_datasets_on_user_id_and_source_digest ON public.datasets USING btree (user_id, source_digest);


--
-- Name: index_login_sessions_on_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_login_sessions_on_expires_at ON public.login_sessions USING btree (expires_at);


--
-- Name: index_login_sessions_on_token_digest; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_login_sessions_on_token_digest ON public.login_sessions USING btree (token_digest);


--
-- Name: index_login_sessions_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_login_sessions_on_user_id ON public.login_sessions USING btree (user_id);


--
-- Name: index_users_on_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_email ON public.users USING btree (email);


--
-- Name: dataset_versions dataset_versions_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER dataset_versions_immutable BEFORE DELETE OR UPDATE ON public.dataset_versions FOR EACH ROW EXECUTE FUNCTION public.reject_dataset_version_mutation();


--
-- Name: dataset_versions fk_rails_319967c499; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_versions
    ADD CONSTRAINT fk_rails_319967c499 FOREIGN KEY (approved_by_id) REFERENCES public.users(id);


--
-- Name: datasets fk_rails_3e18e44f19; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasets
    ADD CONSTRAINT fk_rails_3e18e44f19 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: dataset_versions fk_rails_46f9c5e64c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_versions
    ADD CONSTRAINT fk_rails_46f9c5e64c FOREIGN KEY (dataset_id) REFERENCES public.datasets(id);


--
-- Name: dataset_records fk_rails_8b57992fe9; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dataset_records
    ADD CONSTRAINT fk_rails_8b57992fe9 FOREIGN KEY (dataset_id) REFERENCES public.datasets(id);


--
-- Name: login_sessions fk_rails_8c949dd2cd; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_sessions
    ADD CONSTRAINT fk_rails_8c949dd2cd FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

SET search_path TO "$user", public;

INSERT INTO "schema_migrations" (version) VALUES
('2'),
('10'),
('1');
