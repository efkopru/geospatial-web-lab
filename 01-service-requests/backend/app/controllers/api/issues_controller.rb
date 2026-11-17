module Api
  class IssuesController < ApplicationController
    before_action :require_user!
    before_action :require_staff!, only: %i[update staff]
    # Imports are the route for bulk entry, so one account may create this many requests by hand
    # in ten minutes.
    CREATES_PER_TEN_MINUTES = 120
    rate_limit to: CREATES_PER_TEN_MINUTES, within: 10.minutes, only: :create, by: -> { current_user.id },
      with: -> { render json: { error: 'You are creating requests too quickly. Wait a few minutes and try again.' }, status: :too_many_requests }

    def index
      filters = %i[status category q].index_with { |key| params[key] }.compact_blank
      unless filters.values.all?(String)
        return render json: { error: 'The status, category and search filters must be text.' }, status: :unprocessable_entity
      end
      scope = Issue.visible_to(current_user)
      scope = scope.where(status: filters[:status]) if filters[:status]
      scope = scope.where(category: filters[:category]) if filters[:category]
      if filters[:q]
        term = "%#{Issue.sanitize_sql_like(filters[:q].first(160))}%"
        scope = scope.where('title ILIKE ? OR description ILIKE ?', term, term)
      end
      if %i[latitude longitude radius_m].any? { |key| params[key].present? }
        begin
          lat, lon, radius = %i[latitude longitude radius_m].map { |key| Float(params.require(key)) }
        rescue ArgumentError, TypeError
          return render json: { error: 'Distance filter must contain numeric latitude, longitude, and radius.' }, status: :unprocessable_entity
        end
        unless lat.finite? && lon.finite? && radius.finite? && lat.between?(-90, 90) && lon.between?(-180, 180) && radius.between?(1, 100_000)
          return render json: { error: 'Distance filter requires valid coordinates and a radius from 1 to 100000 meters.' }, status: :unprocessable_entity
        end
        scope = scope.near(lat, lon, radius)
      end
      render json: {
        issues: scope.includes(:reporter, :assigned_to).order(updated_at: :desc).limit(500).map(&:as_payload),
        total_count: scope.count, counts: scope.group(:status).count,
        categories: Issue::CATEGORIES, statuses: Issue::STATUSES
      }
    end

    def show
      render json: { issue: Issue.visible_to(current_user).find(params[:id]).as_payload }
    end

    def create
      issue = Issue.new(params.expect(issue: [:title, :description, :category, :latitude, :longitude]))
      issue.reporter = current_user
      issue.save!
      render json: { issue: issue.as_payload }, status: :created
    end

    def update
      issue = Issue.find(params[:id])
      attrs = params.expect(issue: [:title, :description, :category, :latitude, :longitude, :status, :assigned_to_id, :lock_version])
      return render json: { error: 'lock_version is required. Reload the request before saving.' }, status: :unprocessable_entity unless attrs.key?(:lock_version)
      version = attrs[:lock_version]
      unless (version.is_a?(Integer) && version.between?(0, 2_147_483_647)) ||
             (version.is_a?(String) && version.match?(/\A\d{1,10}\z/) && version.to_i <= 2_147_483_647)
        return render json: { error: 'lock_version must be a nonnegative integer. Reload the request before saving.' }, status: :unprocessable_entity
      end
      issue.assign_attributes(attrs)
      issue.status = 'assigned' if issue.status == 'new' && issue.assigned_to_id.present?
      issue.save!
      render json: { issue: issue.as_payload }
    rescue ActiveRecord::StaleObjectError
      render json: { error: 'Another staff member changed this request. Reloaded values must be reviewed before saving.' }, status: :conflict
    end

    def staff
      render json: { staff: User.where(role: 'staff').order(:name).map { |u| { id: u.id, name: u.name } } }
    end
  end
end
