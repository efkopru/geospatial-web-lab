Rails.application.routes.draw do
  get '/up', to: 'health#show'
  get '/health', to: 'health#show'
  mount ActionCable.server => '/cable'
  namespace :api do
    resource :session, only: %i[show create destroy]
    resources :issues, only: %i[index show create update]
    resources :import_runs, only: %i[index create] do
      post :retry, on: :member
    end
    resources :export_runs, only: %i[index create] do
      get :download, on: :member
    end
    get :staff, to: 'issues#staff'
  end
end
