module Api
 class ParcelsController < ApplicationController
  before_action :require_user!
  def index
   scope = Parcel.all
   if params[:bbox].present?
    begin
     raise ArgumentError unless params[:bbox].is_a?(String)
     bbox = params[:bbox].split(',').map { |v| Float(v) }
     raise ArgumentError unless bbox.length == 4 && bbox.all?(&:finite?) && bbox[0] < bbox[2] && bbox[1] < bbox[3] && bbox.values_at(0,2).all? { |x| x.between?(-180,180) } && bbox.values_at(1,3).all? { |y| y.between?(-90,90) }
    rescue ArgumentError
     return render json: {error: 'bbox requires west,south,east,north in WGS84'}, status: :unprocessable_entity
    end
    scope = scope.where('ST_Intersects(geom, ST_MakeEnvelope(?, ?, ?, ?, 4326))', *bbox)
   end
   scope = scope.where(district: params[:district]) if params[:district].present?
   render json: {type: 'FeatureCollection', features: scope.features}
  end
 end
end
