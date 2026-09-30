module Api
  class VehiclesController < ApplicationController
    before_action :require_user!
    before_action :require_staff!, only: :telemetry

    def history
      vehicle = Vehicle.find(params[:id])
      render json: {
        vehicle: vehicle.payload,
        route: vehicle.route,
        points: vehicle.telemetry_points.order(sequence: :asc).map { |p| p.as_json(only: %i[id sequence longitude latitude speed_kph captured_at]) }
      }
    end

    def telemetry
      replay = ReplayControl.instance
      accepted = false
      replay.with_lock do
        if replay.running?
          return render json: { error: "Pause the simulation before submitting manual telemetry" }, status: :conflict
        end
        vehicle = Vehicle.find(params[:id])
        accepted = TelemetryRecorder.record!(vehicle: vehicle, sequence: params.require(:sequence),
          longitude: params.require(:longitude), latitude: params.require(:latitude), speed_kph: params[:speed_kph] || 0)
        replay.update!(sequence: [replay.sequence, vehicle.reload.last_sequence].max) if accepted
      end
      ReplayEngine.broadcast! if accepted
      render json: { accepted: accepted, reason: accepted ? "recorded" : "duplicate_or_out_of_order" }
    rescue ArgumentError, TypeError => e
      render json: { error: e.message }, status: :unprocessable_entity
    end
  end
end
