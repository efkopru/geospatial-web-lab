Rails.application.configure do
 config.eager_load = true
 config.enable_reloading = false
 config.consider_all_requests_local = false
 config.force_ssl = ENV["FORCE_SSL"] == "true"
 config.assume_ssl = ENV["FORCE_SSL"] == "true"
 config.log_level = :info
 config.logger = ActiveSupport::Logger.new(STDOUT)
end
