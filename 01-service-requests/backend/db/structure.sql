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
-- Name: export_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.export_runs (
    id bigint NOT NULL,
    requested_by_id bigint NOT NULL,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    record_count integer DEFAULT 0 NOT NULL,
    content text,
    failure text,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: export_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.export_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: export_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.export_runs_id_seq OWNED BY public.export_runs.id;


--
-- Name: import_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_runs (
    id bigint NOT NULL,
    requested_by_id bigint NOT NULL,
    digest character varying NOT NULL,
    payload jsonb NOT NULL,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    processed_count integer DEFAULT 0 NOT NULL,
    imported_count integer DEFAULT 0 NOT NULL,
    row_errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    failure text,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: import_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.import_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: import_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.import_runs_id_seq OWNED BY public.import_runs.id;


--
-- Name: issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issues (
    id bigint NOT NULL,
    title character varying NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    category character varying NOT NULL,
    status character varying DEFAULT 'new'::character varying NOT NULL,
    reporter_id bigint NOT NULL,
    assigned_to_id bigint,
    latitude numeric(10,7) NOT NULL,
    longitude numeric(10,7) NOT NULL,
    source_key character varying,
    lock_version integer DEFAULT 0 NOT NULL,
    resolved_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    location public.geography(Point,4326) GENERATED ALWAYS AS ((public.st_setsrid(public.st_makepoint((longitude)::double precision, (latitude)::double precision), 4326))::public.geography) STORED,
    CONSTRAINT valid_issue_coordinates CHECK ((((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric)) AND ((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric))))
);


--
-- Name: issues_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.issues_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: issues_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.issues_id_seq OWNED BY public.issues.id;


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
-- Name: export_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_runs ALTER COLUMN id SET DEFAULT nextval('public.export_runs_id_seq'::regclass);


--
-- Name: import_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_runs ALTER COLUMN id SET DEFAULT nextval('public.import_runs_id_seq'::regclass);


--
-- Name: issues id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues ALTER COLUMN id SET DEFAULT nextval('public.issues_id_seq'::regclass);


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
-- Name: export_runs export_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_runs
    ADD CONSTRAINT export_runs_pkey PRIMARY KEY (id);


--
-- Name: import_runs import_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_runs
    ADD CONSTRAINT import_runs_pkey PRIMARY KEY (id);


--
-- Name: issues issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT issues_pkey PRIMARY KEY (id);


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
-- Name: index_export_runs_on_requested_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_export_runs_on_requested_by_id ON public.export_runs USING btree (requested_by_id);


--
-- Name: index_import_runs_on_requested_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_import_runs_on_requested_by_id ON public.import_runs USING btree (requested_by_id);


--
-- Name: index_import_runs_on_requested_by_id_and_digest; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_import_runs_on_requested_by_id_and_digest ON public.import_runs USING btree (requested_by_id, digest);


--
-- Name: index_issues_on_assigned_to_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_issues_on_assigned_to_id ON public.issues USING btree (assigned_to_id);


--
-- Name: index_issues_on_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_issues_on_location ON public.issues USING gist (location);


--
-- Name: index_issues_on_reporter_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_issues_on_reporter_id ON public.issues USING btree (reporter_id);


--
-- Name: index_issues_on_source_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_issues_on_source_key ON public.issues USING btree (source_key);


--
-- Name: index_issues_on_status_and_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_issues_on_status_and_category ON public.issues USING btree (status, category);


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
-- Name: login_sessions fk_rails_8c949dd2cd; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_sessions
    ADD CONSTRAINT fk_rails_8c949dd2cd FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: issues fk_rails_a1f8aadbc6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT fk_rails_a1f8aadbc6 FOREIGN KEY (assigned_to_id) REFERENCES public.users(id);


--
-- Name: import_runs fk_rails_d7c9816199; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_runs
    ADD CONSTRAINT fk_rails_d7c9816199 FOREIGN KEY (requested_by_id) REFERENCES public.users(id);


--
-- Name: export_runs fk_rails_e43411bcad; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_runs
    ADD CONSTRAINT fk_rails_e43411bcad FOREIGN KEY (requested_by_id) REFERENCES public.users(id);


--
-- Name: issues fk_rails_e760f5afbf; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues
    ADD CONSTRAINT fk_rails_e760f5afbf FOREIGN KEY (reporter_id) REFERENCES public.users(id);


--
-- PostgreSQL database dump complete
--

SET search_path TO "$user", public;

INSERT INTO "schema_migrations" (version) VALUES
('2'),
('10'),
('1');
