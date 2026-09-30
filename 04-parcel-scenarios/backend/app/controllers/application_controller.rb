class ApplicationController < ActionController::Base
 protect_from_forgery with: :exception
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
end
