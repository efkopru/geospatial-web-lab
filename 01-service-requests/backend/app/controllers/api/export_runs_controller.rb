module Api
  class ExportRunsController < ApplicationController
    before_action :require_user!
    before_action :require_staff!

    def index
      render json: { exports: ExportRun.where(requested_by: current_user).order(created_at: :desc).limit(10).map(&:as_payload) }
    end

    def create
      run = ExportRun.create!(requested_by: current_user)
      begin
        raise ActiveJob::EnqueueError, 'Export enqueue was cancelled' unless ExportIssuesJob.perform_later(run.id)
      rescue StandardError => error
        Rails.logger.error("Export #{run.id} could not be queued: #{error.class}: #{error.message}")
        run.with_lock do
          run.update!(status: 'failed', failure: 'Could not queue this report. Generate a new report when the background service is available.') if run.status == 'pending'
        end
        unless %w[processing completed].include?(run.status)
          return render json: { error: run.failure, export: run.as_payload }, status: :service_unavailable
        end
      end
      render json: { export: run.as_payload }, status: :accepted
    end

    def download
      run = ExportRun.where(requested_by: current_user).find(params[:id])
      return render json: { error: 'The report is not ready.' }, status: :conflict unless run.status == 'completed'
      send_data run.content, filename: "service-requests-#{run.id}.csv", type: 'text/csv; charset=utf-8', disposition: 'attachment'
    end
  end
end
