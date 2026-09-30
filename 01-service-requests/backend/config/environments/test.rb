Rails.application.configure do
 config.enable_reloading = false
 config.eager_load = false
 config.consider_all_requests_local = true
 config.action_controller.allow_forgery_protection = false
 config.active_job.queue_adapter = :test
 config.active_record.maintain_test_schema = false
 config.hosts.clear
end
