module Api
  class FleetController < ApplicationController
    before_action :require_user!
    before_action :require_staff!, only: :control

    def show
      render json: {
        replay: ReplayControl.instance.payload,
        vehicles: Vehicle.includes(:geofence_memberships).order(:id).map(&:payload),
        geofences: Geofence.order(:id).map(&:payload),
        events: GeofenceEvent.includes(:vehicle, :geofence).order(id: :desc).limit(100).map(&:payload),
        history_limit: TelemetryRecorder::HISTORY_LIMIT,
        event_limit: TelemetryRecorder::EVENT_LIMIT
      }
    end

    def control
      replay = ReplayEngine.control!(params.require(:action_name), speed: params[:speed])
      render json: { replay: replay.payload }
    rescue ArgumentError, TypeError => e
      render json: { error: e.message }, status: :unprocessable_entity
    rescue ActiveJob::EnqueueError
      render json: { error: "Replay could not be queued. Check the job service and retry." }, status: :service_unavailable
    end
  end
end
