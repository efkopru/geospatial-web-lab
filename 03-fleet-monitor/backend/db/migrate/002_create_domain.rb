class CreateDomain < ActiveRecord::Migration[8.1]
  def change
    enable_extension "postgis" unless extension_enabled?("postgis")
    create_table :replay_controls do |t|
      t.boolean :running, null: false, default: false
      t.integer :generation, null: false, default: 0
      t.integer :cursor, null: false, default: 0
      t.integer :sequence, null: false, default: 0
      t.integer :speed, null: false, default: 1
      t.timestamps
    end
    add_check_constraint :replay_controls, "id = 1", name: "single_replay_controller"
    add_check_constraint :replay_controls, "speed IN (1, 2, 4)", name: "valid_replay_speed"

    create_table :vehicles do |t|
      t.string :name, null: false
      t.string :registration, null: false
      t.string :color, null: false
      t.jsonb :route, null: false, default: []
      t.integer :route_offset, null: false, default: 0
      t.integer :last_sequence, null: false, default: -1
      t.float :longitude
      t.float :latitude
      t.float :speed_kph, null: false, default: 0
      t.datetime :captured_at
      t.timestamps
    end
    add_index :vehicles, :registration, unique: true

    create_table :telemetry_points do |t|
      t.references :vehicle, null: false, foreign_key: true
      t.integer :sequence, null: false
      t.float :longitude, null: false
      t.float :latitude, null: false
      t.float :speed_kph, null: false
      t.datetime :captured_at, null: false
    end
    add_index :telemetry_points, %i[vehicle_id sequence], unique: true
    execute "ALTER TABLE telemetry_points ADD COLUMN geom geometry(Point,4326) NOT NULL"
    execute "CREATE INDEX index_telemetry_points_on_geom ON telemetry_points USING GIST (geom)"

    create_table :geofences do |t|
      t.string :name, null: false
      t.string :color, null: false, default: "#7c3aed"
      t.jsonb :coordinates, null: false
      t.timestamps
    end
    execute "ALTER TABLE geofences ADD COLUMN geom geometry(Polygon,4326)"
    execute "CREATE INDEX index_geofences_on_geom ON geofences USING GIST (geom)"

    create_table :geofence_memberships do |t|
      t.references :vehicle, null: false, foreign_key: true
      t.references :geofence, null: false, foreign_key: true
      t.boolean :inside, null: false, default: false
      t.timestamps
    end
    add_index :geofence_memberships, %i[vehicle_id geofence_id], unique: true

    create_table :geofence_events do |t|
      t.references :vehicle, null: false, foreign_key: true
      t.references :geofence, null: false, foreign_key: true
      t.string :transition, null: false
      t.integer :sequence, null: false
      t.datetime :captured_at, null: false
    end
    add_index :geofence_events, %i[vehicle_id geofence_id sequence], unique: true, name: "index_geofence_events_on_transition_sequence"
  end
end
