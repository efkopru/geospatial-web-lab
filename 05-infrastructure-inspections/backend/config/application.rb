require_relative "boot"
require "rails"
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
require "action_controller/railtie"
require "action_cable/engine"
require "rails/test_unit/railtie"
Bundler.require(*Rails.groups)
module GeoLab
 class Application < Rails::Application
  config.load_defaults 8.1
  config.eager_load = false
  config.autoload_lib(ignore: %w[assets tasks])
  config.active_record.schema_format = :sql
  config.active_job.queue_adapter = :sidekiq
  config.session_store :cookie_store, key: "_infrastructure_inspections_session", same_site: :lax, httponly: true, secure: ENV["SECURE_COOKIES"] == "true"
  config.action_cable.allowed_request_origins = ENV.fetch("ALLOWED_ORIGINS", "http://localhost:5175,http://127.0.0.1:5175,http://localhost:3105").split(",")
  config.secret_key_base = ENV.fetch("SECRET_KEY_BASE") { Rails.env.production? ? raise("Set SECRET_KEY_BASE in production") : "development-only-infrastructure_inspections-" + "x" * 64 }
  config.filter_parameters += [:password, :password_confirmation, :token, :secret]
  config.hosts = ENV.fetch("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
  config.host_authorization = { exclude: ->(request) { request.path == "/up" } }
 end
end
