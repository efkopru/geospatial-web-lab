class CreateDomain < ActiveRecord::Migration[8.1]
 def change
  create_table :parcels do |t|
   t.string :name, null: false
   t.string :district, null: false
   t.integer :height_limit, null: false, default: 12
   t.jsonb :boundary, null: false
   t.timestamps
  end
  reversible do |direction|
   direction.up do
    execute "ALTER TABLE parcels ADD COLUMN geom geometry(Polygon,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_GeomFromGeoJSON(boundary::text),4326)) STORED"
    execute 'CREATE INDEX index_parcels_geom ON parcels USING gist(geom)'
   end
   direction.down { execute 'ALTER TABLE parcels DROP COLUMN geom' }
  end
  add_index :parcels, :name, unique: true
  create_table :scenarios do |t|
   t.references :user, null: false, foreign_key: true
   t.string :name, null: false
   t.string :status, null: false, default: 'queued'
   t.jsonb :parcel_ids, null: false, default: []
   t.integer :floors, null: false
   t.decimal :coverage, precision: 4, scale: 3, null: false
   t.integer :unit_area, null: false
   t.jsonb :results, null: false, default: {}
   t.integer :revision, null: false, default: 1
   t.text :error_message
   t.timestamps
  end
 end
end
