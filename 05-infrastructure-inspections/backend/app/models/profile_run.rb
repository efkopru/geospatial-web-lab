class ProfileRun < ApplicationRecord
  belongs_to :user
  validates :status, inclusion: { in: %w[pending processing completed failed] }
  # Completed runs keep their asset snapshot and samples, so only the newest are kept, as in the
  # standalone edition. Pending, processing and failed runs stay so they can finish or be retried.
  KEEP_COMPLETED = 20

  def self.prune_completed!
    completed = where(status: "completed")
    completed.where.not(id: completed.order(id: :desc).limit(KEEP_COMPLETED).select(:id)).delete_all
  end

  # First key of the session advisory lock ProfileJob holds for a whole run; the run id is the second.
  ADVISORY_LOCK_KEY = 10501

  # A run is abandoned when it is still 'processing' but no worker holds its lock, for example after
  # a worker process was killed: PostgreSQL releases a session lock when its connection ends.
  # pg_locks is read rather than the lock taken, so this check never blocks a worker that is starting.
  def abandoned?
    status == "processing" && !self.class.connection.select_value(self.class.sanitize_sql_array([<<~SQL, ADVISORY_LOCK_KEY, id]))
      SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND classid = ? AND objid = ? AND objsubid = 2)
    SQL
  end

  def payload
    as_json(only: %i[id status generation summary error_message completed_at created_at]).merge(
      "abandoned" => abandoned?, "source" => "Synthetic asset elevations; linear interpolation; not a DEM")
  end

  def document
    {
      type: "FeatureCollection", name: "synthetic-corridor-profile-#{id}",
      metadata: { source: "SYNTHETIC DATA: linearly interpolated asset base elevations, not a surveyed terrain model", summary: summary, assets: asset_snapshot },
      features: samples.map { |sample| { type: "Feature", properties: { distance_m: sample["distance_m"], synthetic_elevation_m: sample["elevation_m"] }, geometry: { type: "Point", coordinates: [sample["longitude"], sample["latitude"], sample["elevation_m"]] } } }
    }
  end
end
