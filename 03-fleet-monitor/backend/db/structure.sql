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
-- Name: geofence_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geofence_events (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    geofence_id bigint NOT NULL,
    transition character varying NOT NULL,
    sequence integer NOT NULL,
    captured_at timestamp(6) without time zone NOT NULL
);


--
-- Name: geofence_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.geofence_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: geofence_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.geofence_events_id_seq OWNED BY public.geofence_events.id;


--
-- Name: geofence_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geofence_memberships (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    geofence_id bigint NOT NULL,
    inside boolean DEFAULT false NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: geofence_memberships_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.geofence_memberships_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: geofence_memberships_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.geofence_memberships_id_seq OWNED BY public.geofence_memberships.id;


--
-- Name: geofences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geofences (
    id bigint NOT NULL,
    name character varying NOT NULL,
    color character varying DEFAULT '#7c3aed'::character varying NOT NULL,
    coordinates jsonb NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    geom public.geometry(Polygon,4326)
);


--
-- Name: geofences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.geofences_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: geofences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.geofences_id_seq OWNED BY public.geofences.id;


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
-- Name: replay_controls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.replay_controls (
    id bigint NOT NULL,
    running boolean DEFAULT false NOT NULL,
    generation integer DEFAULT 0 NOT NULL,
    cursor integer DEFAULT 0 NOT NULL,
    sequence integer DEFAULT 0 NOT NULL,
    speed integer DEFAULT 1 NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT single_replay_controller CHECK ((id = 1)),
    CONSTRAINT valid_replay_speed CHECK ((speed = ANY (ARRAY[1, 2, 4])))
);


--
-- Name: replay_controls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.replay_controls_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: replay_controls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.replay_controls_id_seq OWNED BY public.replay_controls.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: telemetry_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_points (
    id bigint NOT NULL,
    vehicle_id bigint NOT NULL,
    sequence integer NOT NULL,
    longitude double precision NOT NULL,
    latitude double precision NOT NULL,
    speed_kph double precision NOT NULL,
    captured_at timestamp(6) without time zone NOT NULL,
    geom public.geometry(Point,4326) NOT NULL
);


--
-- Name: telemetry_points_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.telemetry_points_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: telemetry_points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.telemetry_points_id_seq OWNED BY public.telemetry_points.id;


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
-- Name: vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicles (
    id bigint NOT NULL,
    name character varying NOT NULL,
    registration character varying NOT NULL,
    color character varying NOT NULL,
    route jsonb DEFAULT '[]'::jsonb NOT NULL,
    route_offset integer DEFAULT 0 NOT NULL,
    last_sequence integer DEFAULT '-1'::integer NOT NULL,
    longitude double precision,
    latitude double precision,
    speed_kph double precision DEFAULT 0.0 NOT NULL,
    captured_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: vehicles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vehicles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vehicles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vehicles_id_seq OWNED BY public.vehicles.id;


--
-- Name: geofence_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofence_events ALTER COLUMN id SET DEFAULT nextval('public.geofence_events_id_seq'::regclass);


--
-- Name: geofence_memberships id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofence_memberships ALTER COLUMN id SET DEFAULT nextval('public.geofence_memberships_id_seq'::regclass);


--
-- Name: geofences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofences ALTER COLUMN id SET DEFAULT nextval('public.geofences_id_seq'::regclass);


--
-- Name: login_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_sessions ALTER COLUMN id SET DEFAULT nextval('public.login_sessions_id_seq'::regclass);


--
-- Name: replay_controls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.replay_controls ALTER COLUMN id SET DEFAULT nextval('public.replay_controls_id_seq'::regclass);


--
-- Name: telemetry_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_points ALTER COLUMN id SET DEFAULT nextval('public.telemetry_points_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: vehicles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles ALTER COLUMN id SET DEFAULT nextval('public.vehicles_id_seq'::regclass);


--
-- Name: ar_internal_metadata ar_internal_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_internal_metadata
    ADD CONSTRAINT ar_internal_metadata_pkey PRIMARY KEY (key);


--
-- Name: geofence_events geofence_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofence_events
    ADD CONSTRAINT geofence_events_pkey PRIMARY KEY (id);


--
-- Name: geofence_memberships geofence_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofence_memberships
    ADD CONSTRAINT geofence_memberships_pkey PRIMARY KEY (id);


--
-- Name: geofences geofences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofences
    ADD CONSTRAINT geofences_pkey PRIMARY KEY (id);


--
-- Name: login_sessions login_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_sessions
    ADD CONSTRAINT login_sessions_pkey PRIMARY KEY (id);


--
-- Name: replay_controls replay_controls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.replay_controls
    ADD CONSTRAINT replay_controls_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: telemetry_points telemetry_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_points
    ADD CONSTRAINT telemetry_points_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- Name: index_geofence_events_on_geofence_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_geofence_events_on_geofence_id ON public.geofence_events USING btree (geofence_id);


--
-- Name: index_geofence_events_on_transition_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_geofence_events_on_transition_sequence ON public.geofence_events USING btree (vehicle_id, geofence_id, sequence);


--
-- Name: index_geofence_events_on_vehicle_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_geofence_events_on_vehicle_id ON public.geofence_events USING btree (vehicle_id);


--
-- Name: index_geofence_memberships_on_geofence_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_geofence_memberships_on_geofence_id ON public.geofence_memberships USING btree (geofence_id);


--
-- Name: index_geofence_memberships_on_vehicle_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_geofence_memberships_on_vehicle_id ON public.geofence_memberships USING btree (vehicle_id);


--
-- Name: index_geofence_memberships_on_vehicle_id_and_geofence_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_geofence_memberships_on_vehicle_id_and_geofence_id ON public.geofence_memberships USING btree (vehicle_id, geofence_id);


--
-- Name: index_geofences_on_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_geofences_on_geom ON public.geofences USING gist (geom);


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
-- Name: index_telemetry_points_on_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_telemetry_points_on_geom ON public.telemetry_points USING gist (geom);


--
-- Name: index_telemetry_points_on_vehicle_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_telemetry_points_on_vehicle_id ON public.telemetry_points USING btree (vehicle_id);


--
-- Name: index_telemetry_points_on_vehicle_id_and_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_telemetry_points_on_vehicle_id_and_sequence ON public.telemetry_points USING btree (vehicle_id, sequence);


--
-- Name: index_users_on_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_email ON public.users USING btree (email);


--
-- Name: index_vehicles_on_registration; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_vehicles_on_registration ON public.vehicles USING btree (registration);


--
-- Name: geofence_events fk_rails_0cd99f4fcb; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofence_events
    ADD CONSTRAINT fk_rails_0cd99f4fcb FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: geofence_memberships fk_rails_7d3b678e66; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofence_memberships
    ADD CONSTRAINT fk_rails_7d3b678e66 FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: telemetry_points fk_rails_8b2fa1ff22; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_points
    ADD CONSTRAINT fk_rails_8b2fa1ff22 FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: login_sessions fk_rails_8c949dd2cd; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_sessions
    ADD CONSTRAINT fk_rails_8c949dd2cd FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: geofence_memberships fk_rails_a1ea718176; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofence_memberships
    ADD CONSTRAINT fk_rails_a1ea718176 FOREIGN KEY (geofence_id) REFERENCES public.geofences(id);


--
-- Name: geofence_events fk_rails_f9ff5441ec; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofence_events
    ADD CONSTRAINT fk_rails_f9ff5441ec FOREIGN KEY (geofence_id) REFERENCES public.geofences(id);


--
-- PostgreSQL database dump complete
--

SET search_path TO "$user", public;

INSERT INTO "schema_migrations" (version) VALUES
('2'),
('10'),
('1');
