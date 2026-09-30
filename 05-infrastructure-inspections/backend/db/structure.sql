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
-- Name: infrastructure_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.infrastructure_assets (
    id bigint NOT NULL,
    asset_code character varying NOT NULL,
    name character varying NOT NULL,
    kind character varying NOT NULL,
    longitude double precision NOT NULL,
    latitude double precision NOT NULL,
    ground_elevation_m double precision NOT NULL,
    structure_height_m double precision NOT NULL,
    corridor_order integer NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    geom public.geometry(PointZ,4326)
);


--
-- Name: infrastructure_assets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.infrastructure_assets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: infrastructure_assets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.infrastructure_assets_id_seq OWNED BY public.infrastructure_assets.id;


--
-- Name: inspection_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_events (
    id bigint NOT NULL,
    inspection_id bigint NOT NULL,
    actor_id bigint NOT NULL,
    action character varying NOT NULL,
    notes text NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: inspection_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inspection_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inspection_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inspection_events_id_seq OWNED BY public.inspection_events.id;


--
-- Name: inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspections (
    id bigint NOT NULL,
    infrastructure_asset_id bigint NOT NULL,
    author_id bigint NOT NULL,
    resolved_by_id bigint,
    severity character varying NOT NULL,
    status character varying DEFAULT 'open'::character varying NOT NULL,
    notes text NOT NULL,
    resolution_notes text,
    observed_at timestamp(6) without time zone NOT NULL,
    resolved_at timestamp(6) without time zone,
    lock_version integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: inspections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inspections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inspections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inspections_id_seq OWNED BY public.inspections.id;


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
-- Name: profile_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_runs (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    generation integer DEFAULT 0 NOT NULL,
    asset_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    samples jsonb DEFAULT '[]'::jsonb NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    completed_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: profile_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.profile_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: profile_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.profile_runs_id_seq OWNED BY public.profile_runs.id;


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
-- Name: infrastructure_assets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.infrastructure_assets ALTER COLUMN id SET DEFAULT nextval('public.infrastructure_assets_id_seq'::regclass);


--
-- Name: inspection_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_events ALTER COLUMN id SET DEFAULT nextval('public.inspection_events_id_seq'::regclass);


--
-- Name: inspections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections ALTER COLUMN id SET DEFAULT nextval('public.inspections_id_seq'::regclass);


--
-- Name: login_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_sessions ALTER COLUMN id SET DEFAULT nextval('public.login_sessions_id_seq'::regclass);


--
-- Name: profile_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_runs ALTER COLUMN id SET DEFAULT nextval('public.profile_runs_id_seq'::regclass);


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
-- Name: infrastructure_assets infrastructure_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.infrastructure_assets
    ADD CONSTRAINT infrastructure_assets_pkey PRIMARY KEY (id);


--
-- Name: inspection_events inspection_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_events
    ADD CONSTRAINT inspection_events_pkey PRIMARY KEY (id);


--
-- Name: inspections inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_pkey PRIMARY KEY (id);


--
-- Name: login_sessions login_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_sessions
    ADD CONSTRAINT login_sessions_pkey PRIMARY KEY (id);


--
-- Name: profile_runs profile_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_runs
    ADD CONSTRAINT profile_runs_pkey PRIMARY KEY (id);


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
-- Name: index_infrastructure_assets_on_asset_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_infrastructure_assets_on_asset_code ON public.infrastructure_assets USING btree (asset_code);


--
-- Name: index_infrastructure_assets_on_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_infrastructure_assets_on_geom ON public.infrastructure_assets USING gist (geom);


--
-- Name: index_inspection_events_on_actor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inspection_events_on_actor_id ON public.inspection_events USING btree (actor_id);


--
-- Name: index_inspection_events_on_inspection_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inspection_events_on_inspection_id ON public.inspection_events USING btree (inspection_id);


--
-- Name: index_inspections_on_author_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inspections_on_author_id ON public.inspections USING btree (author_id);


--
-- Name: index_inspections_on_infrastructure_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inspections_on_infrastructure_asset_id ON public.inspections USING btree (infrastructure_asset_id);


--
-- Name: index_inspections_on_resolved_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inspections_on_resolved_by_id ON public.inspections USING btree (resolved_by_id);


--
-- Name: index_inspections_on_status_and_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inspections_on_status_and_severity ON public.inspections USING btree (status, severity);


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
-- Name: index_profile_runs_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_profile_runs_on_user_id ON public.profile_runs USING btree (user_id);


--
-- Name: index_users_on_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_email ON public.users USING btree (email);


--
-- Name: inspection_events fk_rails_201d704213; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_events
    ADD CONSTRAINT fk_rails_201d704213 FOREIGN KEY (inspection_id) REFERENCES public.inspections(id);


--
-- Name: inspection_events fk_rails_35dd41ea63; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_events
    ADD CONSTRAINT fk_rails_35dd41ea63 FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: inspections fk_rails_752d28ca54; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT fk_rails_752d28ca54 FOREIGN KEY (resolved_by_id) REFERENCES public.users(id);


--
-- Name: inspections fk_rails_7f6ab6b85b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT fk_rails_7f6ab6b85b FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: profile_runs fk_rails_7fbf47f633; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_runs
    ADD CONSTRAINT fk_rails_7fbf47f633 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: login_sessions fk_rails_8c949dd2cd; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_sessions
    ADD CONSTRAINT fk_rails_8c949dd2cd FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: inspections fk_rails_cac4e004a9; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT fk_rails_cac4e004a9 FOREIGN KEY (infrastructure_asset_id) REFERENCES public.infrastructure_assets(id);


--
-- PostgreSQL database dump complete
--

SET search_path TO "$user", public;

INSERT INTO "schema_migrations" (version) VALUES
('2'),
('10'),
('1');
