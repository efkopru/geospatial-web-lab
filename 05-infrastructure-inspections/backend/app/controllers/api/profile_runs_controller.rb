module Api
  class ProfileRunsController < ApplicationController
    before_action :require_user!

    def index
      render json: { profile_runs: owned_runs.order(id: :desc).limit(10).map(&:payload) }
    end

    def show
      run = owned_runs.find(params[:id])
      render json: { profile_run: run.payload, samples: run.samples, assets: run.asset_snapshot }
    end

    def create
      snapshot = InfrastructureAsset.includes(:inspections).order(:corridor_order, :id).map(&:payload)
      return render(json: { error: "At least two assets are required" }, status: :unprocessable_entity) if snapshot.length < 2
      run = ProfileRun.create!(user: current_user, asset_snapshot: snapshot)
      enqueue(run)
      render json: { profile_run: run.reload.payload }, status: :accepted
    end

    def retry
      run = owned_runs.find(params[:id])
      run.with_lock do
        unless run.status == "failed" || run.abandoned?
          message = run.status == "processing" ? "This profile run is still being processed" : "Only failed or abandoned runs can be retried"
          return render(json: { error: message }, status: :conflict)
        end
        run.update!(status: "pending", generation: run.generation + 1, error_message: nil, completed_at: nil)
      end
      enqueue(run)
      render json: { profile_run: run.reload.payload }, status: :accepted
    end

    def download
      run = owned_runs.find(params[:id])
      return render(json: { error: "Profile is not complete" }, status: :conflict) unless run.status == "completed"
      send_data JSON.pretty_generate(run.document), filename: "synthetic-corridor-profile-#{run.id}.geojson", type: "application/geo+json", disposition: "attachment"
    end

    private

    def owned_runs
      ProfileRun.where(user_id: current_user.id)
    end

    def enqueue(run)
      generation = run.generation
      job = ProfileJob.perform_later(run.id, generation)
      raise ActiveJob::EnqueueError, "Profile preprocessing was not queued" unless job && job.successfully_enqueued?
    rescue StandardError => error
      # A queue acknowledgement can fail after delivery. Do not overwrite a
      # worker's processing/completed result or a later retry generation.
      ProfileRun.where(id: run.id, generation: generation, status: "pending").update_all(
        status: "failed", error_message: "Could not queue preprocessing. Check the job service and retry.", updated_at: Time.current)
      Rails.logger.error("Could not enqueue profile #{run.id}: #{error.message}")
    end
  end
end
