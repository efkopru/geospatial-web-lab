module Api
  class InspectionsController < ApplicationController
    before_action :require_user!
    before_action :require_staff!, only: :update

    def create
      asset = InfrastructureAsset.find(params[:asset_id])
      inspection = asset.inspections.create!(inspection_parameters.permit(:severity, :notes, :observed_at).merge(author: current_user, status: "open"))
      broadcast(inspection)
      render json: { inspection: inspection.payload }, status: :created
    end

    def update
      inspection = Inspection.find(params[:id])
      attributes = inspection_parameters.permit(:status, :resolution_notes, :lock_version)
      requested_status = attributes[:status]
      unless %w[open resolved].include?(requested_status) && requested_status != inspection.status
        return render json: { error: "Choose a different status: open or resolved" }, status: :unprocessable_entity
      end
      notes = attributes[:resolution_notes].to_s.strip
      unless notes.length.between?(10, 2000)
        return render json: { error: "Resolution or reopening notes must contain 10 to 2000 characters" }, status: :unprocessable_entity
      end
      version = attributes[:lock_version]
      valid_version = (version.is_a?(Integer) && version.between?(0, 2_147_483_647)) ||
        (version.is_a?(String) && version.match?(/\A\d{1,10}\z/) && version.to_i <= 2_147_483_647)
      unless valid_version
        return render json: { error: "lock_version must be an integer from 0 to 2147483647 to prevent overwriting another update" }, status: :bad_request
      end
      Inspection.transaction do
        inspection.update!(status: requested_status, resolution_notes: notes, lock_version: attributes[:lock_version],
          resolved_by: requested_status == "resolved" ? current_user : nil, resolved_at: requested_status == "resolved" ? Time.current : nil)
        inspection.inspection_events.create!(actor: current_user, action: requested_status == "resolved" ? "resolved" : "reopened", notes: notes)
      end
      broadcast(inspection)
      render json: { inspection: inspection.payload }
    end

    private

    def inspection_parameters
      params.expect(inspection: [:severity, :notes, :observed_at, :status, :resolution_notes, :lock_version])
    end

    def broadcast(inspection)
      ActionCable.server.broadcast("infrastructure_inspections", { type: "inspection.updated", asset_id: inspection.infrastructure_asset_id })
    rescue StandardError => error
      Rails.logger.warn("Inspection notification failed: #{error.class}: #{error.message}")
    end
  end
end
