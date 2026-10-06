class ImportIssuesJob < ApplicationJob
  queue_as :default
  retry_on StandardError, wait: :polynomially_longer, attempts: 3
  # After these attempts the run stays failed until someone retries it in the app. Without
  # this, Sidekiq's own retries would quietly reprocess it for up to three weeks.
  sidekiq_options retry: false

  def perform(run_id)
    ActiveRecord::Base.connection_pool.with_connection do |connection|
      locked = connection.select_value("SELECT pg_try_advisory_lock(10101, #{Integer(run_id)})")
      return unless locked
      begin
        run = ImportRun.find(run_id)
        return if run.status == 'completed'
        run.update!(status: 'processing', failure: nil, processed_count: 0, imported_count: 0, row_errors: [])
        errors, imported = [], 0
        features = run.payload.fetch('features')
        features.each_with_index do |feature, index|
          source_key = "import:#{run.id}:#{index}"
          begin
            unless Issue.exists?(source_key: source_key)
              raise ArgumentError, 'Expected a GeoJSON Point feature.' unless feature.is_a?(Hash) && feature['type'] == 'Feature' && feature['geometry'].is_a?(Hash) && feature['geometry']['type'] == 'Point'
              coordinates = feature['geometry']['coordinates']
              raise ArgumentError, 'Point coordinates must contain numeric longitude and latitude.' unless coordinates.is_a?(Array) && coordinates.length >= 2 && coordinates.first(2).all? { |n| n.is_a?(Numeric) && n.finite? }
              properties = feature['properties'] || {}
              raise ArgumentError, 'Feature properties must be an object.' unless properties.is_a?(Hash)
              Issue.create!(title: properties['title'], description: properties['description'].to_s,
                category: properties['category'] || 'roads', latitude: coordinates[1], longitude: coordinates[0],
                reporter: run.requested_by, source_key: source_key)
            end
            imported += 1
          rescue ActiveRecord::RecordInvalid, ArgumentError => error
            errors << { row: index + 1, message: error.message }
          end
          if (index + 1) % 25 == 0 || index == features.length - 1
            run.update!(processed_count: index + 1, imported_count: imported, row_errors: errors)
          end
        end
        run.update!(status: 'completed')
      rescue StandardError => error
        Rails.logger.error("Import #{run_id} failed: #{error.class}: #{error.message}")
        run&.update!(status: 'failed', failure: 'Import processing stopped unexpectedly. Retry processing; already imported rows will be reused.')
        raise
      ensure
        connection.execute("SELECT pg_advisory_unlock(10101, #{Integer(run_id)})")
      end
    end
  end
end
