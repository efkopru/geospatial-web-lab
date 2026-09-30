module Api
  class AssetsController < ApplicationController
    before_action :require_user!

    def index
      render json: { assets: InfrastructureAsset.includes(:inspections).order(:corridor_order, :id).map(&:payload), source: "Synthetic corridor assets and elevations" }
    end

    def show
      asset = InfrastructureAsset.includes(:inspections).find(params[:id])
      render json: { asset: asset.payload, inspections: asset.inspections.includes(:author, :resolved_by).order(created_at: :desc).map(&:payload) }
    end
  end
end
