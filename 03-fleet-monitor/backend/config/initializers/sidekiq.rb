Sidekiq.configure_server do |c|
 c.redis = {url: ENV.fetch("REDIS_URL", "redis://127.0.0.1:6379/2")}
 c.average_scheduled_poll_interval = 1
end
Sidekiq.configure_client { |c| c.redis = {url: ENV.fetch("REDIS_URL", "redis://127.0.0.1:6379/2")} }
