module Api
  class GeofencesController < ApplicationController
    before_action :require_staff!

    def create
      geofence = params.require(:geofence)
      return render json: { error: "geofence must be an object" }, status: :bad_request unless geofence.is_a?(ActionController::Parameters)
      attributes = geofence.permit(:name, :color)
      # Coordinate pairs are nested arrays, which strong parameters does not describe. Anything that
      # is not a list of number pairs is left for the model to reject.
      ring = geofence[:coordinates]
      attributes[:coordinates] = ring.is_a?(Array) ? ring.map { |pair| pair.is_a?(Array) ? pair.map { |value| Float(value, exception: false) } : pair } : nil
      fence = nil
      ReplayControl.instance.with_lock { fence = Geofence.create!(attributes) }
      ReplayEngine.broadcast!
      render json: { geofence: fence.payload }, status: :created
    end

    def destroy
      ReplayControl.instance.with_lock { Geofence.find(params[:id]).destroy! }
      ReplayEngine.broadcast!
      head :no_content
    end
  end
end
