class HealthController < ActionController::Base
 def show
  ActiveRecord::Base.connection.execute("SELECT 1")
  render json: {status: "ok", application: "infrastructure-inspections"}
 end
end
