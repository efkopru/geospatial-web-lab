require 'yaml'
require 'pg'
require 'active_record'
require 'securerandom'

# The administrator creates only a temporary, unprivileged role. Each real
# Compose connection definition must handle passwords with URI delimiters.
root = File.expand_path('..', __dir__)
admin = PG.connect(ENV.fetch('ADMIN_DATABASE_URL', 'postgresql:///postgres'))
role = "geolab_password_check_#{SecureRandom.hex(6)}"
password = "audit/s?c@r#e%t:p'a$ss"
previous_password = ENV['PGPASSWORD']
role_created = false
begin
  admin.exec("CREATE ROLE #{admin.quote_ident(role)} LOGIN PASSWORD #{admin.escape_literal(password)}")
  role_created = true
  Dir.glob(File.join(root, '0*/compose.yaml')).sort.each do |path|
    config = YAML.safe_load_file(path, aliases: true)
    env = config.fetch('services').fetch('migrate').fetch('environment')
    url = env.fetch('DATABASE_URL').gsub(/\$\{APP_DATABASE_PASSWORD[^}]*\}/, password)
    url = url.sub('geolab_app', role).sub('@db:', '@127.0.0.1:').sub(%r{/[^/]+\z}, '/postgres')
    ENV['PGPASSWORD'] = env.key?('PGPASSWORD') ? password : nil
    ActiveRecord::Base.establish_connection(url)
    actual = ActiveRecord::Base.connection.select_value('SELECT current_user')
    raise "Connection used unexpected role #{actual}" unless actual == role
    ActiveRecord::Base.connection_pool.disconnect!
    puts "#{File.basename(File.dirname(path))}: password punctuation preserved"
  end
ensure
  ActiveRecord::Base.connection_handler.clear_all_connections!
  ENV['PGPASSWORD'] = previous_password
  admin.exec("DROP ROLE #{admin.quote_ident(role)}") if role_created
  admin.close
end
