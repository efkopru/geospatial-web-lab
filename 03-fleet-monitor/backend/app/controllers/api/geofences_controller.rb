module Api
  class GeofencesController < ApplicationController
    before_action :require_staff!

    def create
      attributes = params.require(:geofence).permit(:name, :color, coordinates: [])
      # Strong parameters intentionally handles scalar fields separately from coordinate pairs.
      attributes[:coordinates] = params.require(:geofence)[:coordinates]&.map { |pair| pair.to_a.map { |v| Float(v) } }
      fence = nil
      ReplayControl.instance.with_lock { fence = Geofence.create!(attributes) }
      ReplayEngine.broadcast!
      render json: { geofence: fence.payload }, status: :created
    rescue ArgumentError, TypeError, NoMethodError => e
      render json: { error: "Invalid polygon coordinates: #{e.message}" }, status: :unprocessable_entity
    end

    def destroy
      ReplayControl.instance.with_lock { Geofence.find(params[:id]).destroy! }
      ReplayEngine.broadcast!
      head :no_content
    end
  end
end
