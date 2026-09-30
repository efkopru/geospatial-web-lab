class ValidateDatasetJob < ApplicationJob
  queue_as :default
  retry_on ActiveRecord::ConnectionNotEstablished, wait: 5.seconds, attempts: 3

  def perform(dataset_id)
    dataset = Dataset.find(dataset_id)
    return if %w[ready approved].include?(dataset.status)
    ActiveRecord::Base.connection_pool.with_connection do |connection|
      # A session advisory lock permits visible progress commits while preventing
      # duplicate Sidekiq deliveries from processing the same dataset concurrently.
      lock_id = 720_000_000 + dataset.id
      locked = connection.select_value("SELECT pg_try_advisory_lock(#{lock_id})")
      return unless locked
      begin
        dataset.reload
        return if %w[ready approved].include?(dataset.status)
        dataset.update!(status: "validating", failure_message: nil)
        validator = GeojsonValidator.new(required_attributes: dataset.required_attributes)
        dataset.source.fetch("features").each_with_index do |feature, ordinal|
          process_record(connection, dataset, validator, feature, ordinal)
          if ((ordinal + 1) % 10).zero? || ordinal == dataset.total_count - 1
            update_counts(dataset)
            dataset.broadcast_progress
          end
        end
        update_counts(dataset)
        dataset.update!(status: "ready")
        dataset.broadcast_progress
      rescue StandardError => error
        # The original exception is logged server-side; API failures never expose
        # connection strings, SQL, or uploaded private values.
        Rails.logger.error("Dataset #{dataset.id} validation failed: #{error.class}: #{error.message}")
        dataset.update!(status: "failed", failure_message: "Validation stopped unexpectedly. Retry processing; existing records will be reused.")
        dataset.broadcast_progress
        raise
      ensure
        connection.execute("SELECT pg_advisory_unlock(#{lock_id})")
      end
    end
  end

  private

  def process_record(connection, dataset, validator, feature, ordinal)
    errors = validator.errors_for(feature)
    geometry_sql = nil
    if errors.empty?
      geometry_json = connection.quote(JSON.generate(feature.fetch("geometry")))
      geometry_sql = "ST_SetSRID(ST_GeomFromGeoJSON(#{geometry_json}),4326)"
      validity = connection.select_one("SELECT ST_IsValid(g) AS valid, ST_IsValidReason(g) AS reason FROM (SELECT #{geometry_sql} AS g) AS geometry_check")
      errors << "Invalid geometry: #{validity['reason']}" unless validity["valid"]
    end
    persist_record(connection, dataset, feature, ordinal, errors, geometry_sql)
  rescue ActiveRecord::StatementInvalid => error
    # PostGIS parser failures concern a single feature. Other database failures
    # must fail the job rather than being mislabeled as rejected input.
    raise unless error.cause.is_a?(PG::InternalError) || error.cause.is_a?(PG::InvalidParameterValue)
    persist_record(connection, dataset, feature, ordinal, errors + ["Geometry could not be parsed by PostGIS"], nil)
  end

  def persist_record(connection, dataset, feature, ordinal, errors, geometry_sql)
    DatasetRecord.transaction do
      record = dataset.dataset_records.find_or_initialize_by(ordinal: ordinal)
      # The CHECK constraint is enforced on every statement, so write geometry
      # before switching accepted=true.
      record.update!(feature: feature.nil? ? {} : feature, validation_errors: errors, accepted: false)
      geometry_expression = errors.empty? ? geometry_sql : "NULL"
      connection.execute("UPDATE dataset_records SET geom = #{geometry_expression} WHERE id = #{record.id.to_i}")
      record.update!(accepted: errors.empty?)
    end
  end

  def update_counts(dataset)
    counts = dataset.dataset_records.group(:accepted).count
    dataset.update!(processed_count: counts.values.sum, valid_count: counts.fetch(true, 0), invalid_count: counts.fetch(false, 0))
  end
end
