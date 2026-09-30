class CreateDomain < ActiveRecord::Migration[8.1]
  def change
    enable_extension "postgis"
    create_table :datasets do |t|
      t.references :user, null: false, foreign_key: true
      t.string :name, null: false
      t.string :status, null: false, default: "queued"
      t.string :source_digest, null: false
      t.jsonb :source, null: false
      t.jsonb :required_attributes, null: false, default: ["asset_id"]
      t.integer :total_count, null: false, default: 0
      t.integer :processed_count, null: false, default: 0
      t.integer :valid_count, null: false, default: 0
      t.integer :invalid_count, null: false, default: 0
      t.text :failure_message
      t.timestamps
    end
    add_index :datasets, %i[user_id source_digest], unique: true
    add_check_constraint :datasets, "status IN ('queued', 'validating', 'ready', 'approved', 'failed')", name: "dataset_status"
    create_table :dataset_records do |t|
      t.references :dataset, null: false, foreign_key: true
      t.integer :ordinal, null: false
      t.jsonb :feature, null: false
      t.jsonb :validation_errors, null: false, default: []
      t.boolean :accepted, null: false, default: false
      t.timestamps
    end
    add_index :dataset_records, %i[dataset_id ordinal], unique: true
    add_index :dataset_records, %i[dataset_id accepted]
    reversible do |direction|
      direction.up do
        execute "ALTER TABLE dataset_records ADD COLUMN geom geometry(Geometry,4326)"
        execute "CREATE INDEX dataset_records_geom_idx ON dataset_records USING gist(geom)"
        execute "ALTER TABLE dataset_records ADD CONSTRAINT accepted_geometry_valid CHECK (NOT accepted OR (geom IS NOT NULL AND ST_IsValid(geom)))"
      end
      direction.down { execute "ALTER TABLE dataset_records DROP COLUMN geom" }
    end
    create_table :dataset_versions do |t|
      t.references :dataset, null: false, foreign_key: true, index: { unique: true }
      t.references :approved_by, null: false, foreign_key: { to_table: :users }
      t.jsonb :content, null: false
      t.text :export_json, null: false
      t.string :digest, null: false
      t.integer :feature_count, null: false
      t.datetime :created_at, null: false
    end
    reversible do |direction|
      direction.up do
        execute <<~SQL
          CREATE FUNCTION reject_dataset_version_mutation() RETURNS trigger AS $$
          BEGIN RAISE EXCEPTION 'Approved dataset versions are immutable'; END;
          $$ LANGUAGE plpgsql;
          CREATE TRIGGER dataset_versions_immutable BEFORE UPDATE OR DELETE ON dataset_versions
          FOR EACH ROW EXECUTE FUNCTION reject_dataset_version_mutation();
        SQL
      end
      direction.down do
        execute "DROP TRIGGER dataset_versions_immutable ON dataset_versions"
        execute "DROP FUNCTION reject_dataset_version_mutation()"
      end
    end
  end
end
