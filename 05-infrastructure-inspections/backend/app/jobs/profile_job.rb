class ProfileJob < ApplicationJob
  queue_as :default

  def perform(id, generation)
    ActiveRecord::Base.connection_pool.with_connection do |connection|
      # Held for the whole run, so a run left 'processing' by a lost worker can be told apart from
      # one still being built (see ProfileRun#abandoned?). A second delivery of the same run exits.
      locked = connection.select_value("SELECT pg_try_advisory_lock(#{ProfileRun::ADVISORY_LOCK_KEY}, #{Integer(id)})")
      return unless locked
      begin
        process(id, generation)
      ensure
        connection.execute("SELECT pg_advisory_unlock(#{ProfileRun::ADVISORY_LOCK_KEY}, #{Integer(id)})")
      end
    end
  end

  private

  def process(id, generation)
    run = ProfileRun.find(id)
    run.with_lock do
      return unless run.generation == generation && %w[pending processing].include?(run.status)
      run.update!(status: "processing", error_message: nil)
    end
    broadcast(run)
    run.with_lock do
      return unless run.generation == generation && run.status == "processing"
      result = CorridorProfile.build(run.asset_snapshot)
      run.update!(status: "completed", samples: result[:samples], summary: result[:summary], completed_at: Time.current)
    end
    ProfileRun.prune_completed!
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

  def broadcast(run)
    ActionCable.server.broadcast("infrastructure_inspections", { type: "profile.updated", id: run.id, status: run.status })
  rescue StandardError => error
    Rails.logger.warn("Profile notification failed: #{error.class}: #{error.message}")
  end
end
