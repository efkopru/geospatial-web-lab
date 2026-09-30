class ProfileJob < ApplicationJob
  queue_as :default

  def perform(id, generation)
    run = ProfileRun.find(id)
    run.with_lock do
      return unless run.generation == generation && %w[pending processing].include?(run.status)
      run.update!(status: "processing", error_message: nil)
    end
    broadcast(run)
    run.with_lock do
      return unless run.generation == generation && run.status == "processing"
      # Serialize duplicate deliveries while allowing a replacement worker to
      # resume a processing record left behind by an interrupted process.
      result = CorridorProfile.build(run.asset_snapshot)
      run.update!(status: "completed", samples: result[:samples], summary: result[:summary], completed_at: Time.current)
    end
    broadcast(run)
  rescue StandardError => error
    if run&.persisted?
      run.with_lock do
        run.update!(status: "failed", error_message: "Profile preprocessing stopped unexpectedly. Retry this run.") if run.generation == generation && run.status != "completed"
      end
      broadcast(run)
    end
    Rails.logger.error("Profile job failed: #{error.class}: #{error.message}")
  end

  private

  def broadcast(run)
    ActionCable.server.broadcast("infrastructure_inspections", { type: "profile.updated", id: run.id, status: run.status })
  rescue StandardError => error
    Rails.logger.warn("Profile notification failed: #{error.class}: #{error.message}")
  end
end
