module Api
 class ScenariosController < ApplicationController
  before_action :require_user!
  def index
   render json: current_user_scenarios.listed
  end
  def show
   render json: current_user_scenarios.find(params[:id])
  end
  def create
   attributes = params.require(:scenario)
   unless attributes.is_a?(ActionController::Parameters)
    return render json: {error: 'scenario must be an object'}, status: :bad_request
   end
   scenario = current_user_scenarios.create!(attributes.permit(:name,:floors,:coverage,:unit_area,parcel_ids: []))
   enqueue(scenario)
   scenario.broadcast
   render json: scenario, status: :created
  end
  def recalculate
   scenario = current_user_scenarios.find(params[:id])
   scenario.with_lock do
    return render(json: {error: 'Only failed scenarios can be retried. Save a new scenario to compare different assumptions.'}, status: :conflict) unless scenario.status == 'failed'
    scenario.update!(status: 'queued', revision: scenario.revision+1, results: {}, error_message: nil)
   end
   enqueue(scenario)
   scenario.broadcast
   render json: scenario
  end
  def export
   scenario = current_user_scenarios.find(params[:id])
   return render(json: {error: 'Scenario calculation must finish first'},status: :conflict) unless scenario.status == 'complete'
   send_data JSON.pretty_generate(scenario.as_json.except('user_id')), type: 'application/json', disposition: 'attachment', filename: "scenario-#{scenario.id}.json"
  end
  def destroy
   scenario = current_user_scenarios.find(params[:id]); scenario.destroy!; scenario.broadcast
   head :no_content
  end
  private
  def enqueue(scenario)
   revision = scenario.revision
   queued = CalculateScenarioJob.perform_later(scenario.id, revision)
   raise ActiveJob::EnqueueError, 'Scenario enqueue was cancelled' unless queued
  rescue StandardError => e
   Rails.logger.error("Scenario queue unavailable: #{e.class}")
   Scenario.where(id: scenario.id, revision: revision, status: 'queued').update_all(status: 'failed', error_message: 'Background queue is unavailable. Retry when the worker connection is restored.', updated_at: Time.current)
   scenario.reload
  end
  def current_user_scenarios = Scenario.where(user_id: current_user.id)
 end
end
