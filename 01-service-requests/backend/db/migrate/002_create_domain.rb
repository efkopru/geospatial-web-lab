class CreateDomain < ActiveRecord::Migration[8.1]
  def change
    enable_extension 'postgis'
    create_table :import_runs do |t|
      t.references :requested_by, null: false, foreign_key: { to_table: :users }
      t.string :digest, null: false
      t.jsonb :payload, null: false
      t.string :status, null: false, default: 'pending'
      t.integer :processed_count, null: false, default: 0
      t.integer :imported_count, null: false, default: 0
      t.jsonb :row_errors, null: false, default: []
      t.text :failure
      t.timestamps
    end
    add_index :import_runs, %i[requested_by_id digest], unique: true
    create_table :issues do |t|
      t.string :title, null: false
      t.text :description, null: false, default: ''
      t.string :category, null: false
      t.string :status, null: false, default: 'new'
      t.references :reporter, null: false, foreign_key: { to_table: :users }
      t.references :assigned_to, foreign_key: { to_table: :users }
      t.decimal :latitude, precision: 10, scale: 7, null: false
      t.decimal :longitude, precision: 10, scale: 7, null: false
      t.string :source_key
      t.integer :lock_version, null: false, default: 0
      t.datetime :resolved_at
      t.timestamps
    end
    add_index :issues, :source_key, unique: true
    add_index :issues, %i[status category]
    add_check_constraint :issues, 'latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180', name: 'valid_issue_coordinates'
    reversible do |dir|
      dir.up do
        execute 'ALTER TABLE issues ADD COLUMN location geography(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision),4326)::geography) STORED'
        execute 'CREATE INDEX index_issues_on_location ON issues USING GIST(location)'
      end
      dir.down { execute 'ALTER TABLE issues DROP COLUMN location' }
    end
    create_table :export_runs do |t|
      t.references :requested_by, null: false, foreign_key: { to_table: :users }
      t.string :status, null: false, default: 'pending'
      t.integer :record_count, null: false, default: 0
      t.text :content
      t.text :failure
      t.timestamps
    end
  end
end
