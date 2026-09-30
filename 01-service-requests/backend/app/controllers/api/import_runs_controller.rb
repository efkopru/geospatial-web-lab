require 'digest'

module Api
  class ImportRunsController < ApplicationController
    before_action :require_user!
    before_action :require_staff!

    def index
      render json: { imports: ImportRun.where(requested_by: current_user).order(created_at: :desc).limit(15).map(&:as_payload) }
    end

    def create
      payload = params.require(:geojson)
      payload = payload.to_unsafe_h if payload.respond_to?(:to_unsafe_h)
      unless payload.is_a?(Hash) && payload['type'] == 'FeatureCollection' && payload['features'].is_a?(Array) && payload['features'].length.between?(1, 500)
        return render json: { error: 'Upload a GeoJSON FeatureCollection containing 1 to 500 Point features.' }, status: :unprocessable_entity
      end
      encoded = JSON.generate(payload)
      return render json: { error: 'GeoJSON must be smaller than 2 MB.' }, status: :unprocessable_entity if encoded.bytesize > 2.megabytes
      digest = Digest::SHA256.hexdigest(encoded)
      run = ImportRun.find_by(requested_by: current_user, digest: digest)
      if run
        return render json: { import: run.as_payload, reused: true }, status: :ok
      end
      run = ImportRun.create!(requested_by: current_user, digest: digest, payload: payload)
      return unless enqueue(run)
      render json: { import: run.as_payload, reused: false }, status: :accepted
    rescue ActiveRecord::RecordNotUnique
      render json: { import: ImportRun.find_by!(requested_by: current_user, digest: digest).as_payload, reused: true }
    rescue ActiveRecord::RecordInvalid => error
      # Another upload can commit between the lookup and uniqueness validation.
      raise unless error.record.is_a?(ImportRun) && error.record.errors.attribute_names == [:digest] && error.record.errors.of_kind?(:digest, :taken)
      render json: { import: ImportRun.find_by!(requested_by: current_user, digest: digest).as_payload, reused: true }
    end

    def retry
      run = ImportRun.where(requested_by: current_user).find(params[:id])
      run.with_lock do
        return render json: { error: 'Only failed imports can be retried.' }, status: :conflict unless run.status == 'failed'
        run.update!(status: 'pending', failure: nil)
      end
      return unless enqueue(run)
      render json: { import: run.as_payload }, status: :accepted
    end

    private

    def enqueue(run)
      raise ActiveJob::EnqueueError, 'Import enqueue was cancelled' unless ImportIssuesJob.perform_later(run.id)
      true
    rescue StandardError => error
      Rails.logger.error("Import #{run.id} could not be queued: #{error.class}: #{error.message}")
      run.with_lock do
        # A lost queue acknowledgment does not mean the worker never received it.
        run.update!(status: 'failed', failure: 'Could not queue this import. Retry when the background service is available.') if run.status == 'pending'
      end
      return true if %w[processing completed].include?(run.status)
      render json: { error: run.failure, import: run.as_payload }, status: :service_unavailable
      false
    end
  end
end
