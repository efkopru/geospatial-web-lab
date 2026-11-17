class ApplicationController < ActionController::Base
 protect_from_forgery with: :exception
 # Every request names the keys it sends, so Rails does not also nest JSON parameters under the
 # controller's name; that copy doubled each request's log entry.
 wrap_parameters false
 before_action :reject_nul_characters
 rescue_from ActiveRecord::RecordNotFound do
  render json: {error: "Record not found"}, status: :not_found
 end
 rescue_from ActiveRecord::RecordInvalid do |e|
  render json: {error: e.record.errors.full_messages.join(", ")}, status: :unprocessable_entity
 end
 rescue_from ActionController::ParameterMissing do |e|
  render json: {error: e.message}, status: :bad_request
 end
 rescue_from ActiveRecord::StaleObjectError do
  render json: {error: "This record changed. Refresh before saving."}, status: :conflict
 end
 rescue_from ActionController::InvalidAuthenticityToken do
  render json: {error: "Session expired. Reload and try again.", code: "invalid_csrf"}, status: :unprocessable_entity
 end
 def current_login_session
  @current_login_session ||= LoginSession.authenticate(session[:login_token])
 end
 def current_user
  current_login_session&.user
 end
 def require_user!
  render json: {error: "Sign in to continue"}, status: :unauthorized unless current_user
 end
 def require_staff!
  return render(json: {error: "Sign in to continue"}, status: :unauthorized) unless current_user
  render json: {error: "Staff access required"}, status: :forbidden unless current_user.staff?
 end

 private

 # PostgreSQL cannot store the NUL character in text or jsonb, and the database driver raises on
 # it. A parameter that contains one is refused here, before it reaches a query. Uploaded file
 # contents arrive as text and are checked by the code that parses them.
 def reject_nul_characters
  location = nul_character_location(request.parameters)
  return unless location
  render json: {error: "#{location} contains the NUL character (\\u0000), which cannot be stored. Remove it and try again."}, status: :unprocessable_entity
 end

 def nul_character_location(value, path = nil)
  case value
  when Hash
   value.each do |key, item|
    return "A parameter name in #{path || 'the request'}" if key.to_s.include?("\u0000")
    found = nul_character_location(item, [path, key].compact.join("."))
    return found if found
   end
  when Array
   value.each_with_index do |item, index|
    found = nul_character_location(item, "#{path}[#{index}]")
    return found if found
   end
  when String
   return "The parameter #{path}" if value.include?("\u0000")
  end
  nil
 end
end
