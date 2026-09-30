class CreateDomain < ActiveRecord::Migration[8.1]
  def change
    enable_extension "postgis" unless extension_enabled?("postgis")
    create_table :infrastructure_assets do |t|
      t.string :asset_code, null: false
      t.string :name, null: false
      t.string :kind, null: false
      t.float :longitude, null: false
      t.float :latitude, null: false
      t.float :ground_elevation_m, null: false
      t.float :structure_height_m, null: false
      t.integer :corridor_order, null: false
      t.timestamps
    end
    add_index :infrastructure_assets, :asset_code, unique: true
    execute "ALTER TABLE infrastructure_assets ADD COLUMN geom geometry(PointZ,4326)"
    execute "CREATE INDEX index_infrastructure_assets_on_geom ON infrastructure_assets USING GIST (geom)"

    create_table :inspections do |t|
      t.references :infrastructure_asset, null: false, foreign_key: true
      t.references :author, null: false, foreign_key: { to_table: :users }
      t.references :resolved_by, foreign_key: { to_table: :users }
      t.string :severity, null: false
      t.string :status, null: false, default: "open"
      t.text :notes, null: false
      t.text :resolution_notes
      t.datetime :observed_at, null: false
      t.datetime :resolved_at
      t.integer :lock_version, null: false, default: 0
      t.timestamps
    end
    add_index :inspections, %i[status severity]
    create_table :inspection_events do |t|
      t.references :inspection, null: false, foreign_key: true
      t.references :actor, null: false, foreign_key: { to_table: :users }
      t.string :action, null: false
      t.text :notes, null: false
      t.timestamps
    end

    create_table :profile_runs do |t|
      t.references :user, null: false, foreign_key: true
      t.string :status, null: false, default: "pending"
      t.integer :generation, null: false, default: 0
      t.jsonb :asset_snapshot, null: false, default: []
      t.jsonb :samples, null: false, default: []
      t.jsonb :summary, null: false, default: {}
      t.text :error_message
      t.datetime :completed_at
      t.timestamps
    end
  end
end
