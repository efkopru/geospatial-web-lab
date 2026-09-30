module Api
  class DatasetsController < ApplicationController
    before_action :require_user!
    before_action :load_dataset, only: %i[show retry approve export]
    before_action :require_staff!, only: :approve
    rescue_from ArgumentError, with: :render_bad_input

    def index
      render json: { datasets: accessible.includes(:user, :dataset_version).order(created_at: :desc).limit(100).map(&:summary) }
    end

    def show
      records = @dataset.dataset_records.order(:ordinal)
      render json: @dataset.summary.merge(
        "records" => records.map { |record| record.as_json(only: %i[id ordinal feature accepted validation_errors]) },
        "preview" => { "type" => "FeatureCollection", "features" => records.select(&:accepted).map { |record| record.feature.merge("id" => record.id) } }
      )
    end

    def create
      dataset, created = Dataset.import!(user: current_user, name: params[:name], source_text: params[:source],
                                         required_attributes: params.fetch(:required_attributes, ["asset_id"]))
      enqueue(dataset) if created
      render json: { dataset: dataset.summary, duplicate: !created }, status: created ? :created : :ok
    end

    def retry
      @dataset.with_lock do
        raise ArgumentError, "Only failed datasets can be retried" unless @dataset.status == "failed"
        @dataset.update!(status: "queued", failure_message: nil)
      end
      enqueue(@dataset)
      raise ArgumentError, @dataset.failure_message if @dataset.status == 'failed'
      render json: { dataset: @dataset.summary }
    end

    def approve
      @dataset.approve!(approver: current_user, acknowledge_rejected: params[:acknowledge_rejected] == true)
      @dataset.broadcast_progress
      render json: { dataset: @dataset.reload.summary }
    end

    def export
      version = @dataset.dataset_version
      raise ArgumentError, "Approve the dataset before exporting" unless version
      response.set_header("X-Content-SHA256", version.digest)
      send_data version.export_json, filename: "dataset-#{@dataset.id}-v1.geojson", type: "application/geo+json", disposition: "attachment"
    end

    private

    def enqueue(dataset)
      raise ActiveJob::EnqueueError, 'Validation enqueue was cancelled' unless ValidateDatasetJob.perform_later(dataset.id)
    rescue StandardError => error
      Rails.logger.error("Dataset #{dataset.id} enqueue failed: #{error.class}")
      dataset.with_lock do
        # Redis may accept a job even when its acknowledgment is lost. Preserve
        # validation progress or completion already committed by that worker.
        dataset.update!(status: "failed", failure_message: "The worker queue is unavailable. Retry when the worker is running.") if dataset.status == 'queued'
      end
    end

    def accessible
      current_user.role == "staff" ? Dataset.all : Dataset.where(user: current_user)
    end

    def load_dataset
      @dataset = accessible.find(params[:id])
    end

    def render_bad_input(error)
      render json: { error: error.message }, status: :unprocessable_entity
    end
  end
end
