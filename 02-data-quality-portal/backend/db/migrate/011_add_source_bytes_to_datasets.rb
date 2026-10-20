class AddSourceBytesToDatasets < ActiveRecord::Migration[8.1]
  # A minimal model so the backfill does not depend on the application's Dataset class.
  class MigrationDataset < ActiveRecord::Base
    self.table_name = "datasets"
  end

  def change
    add_column :datasets, :source_bytes, :integer, null: false, default: 0
    reversible do |direction|
      # Existing datasets are measured once as compact JSON, as new uploads are.
      direction.up do
        MigrationDataset.reset_column_information
        MigrationDataset.select(:id, :source).find_each do |dataset|
          MigrationDataset.where(id: dataset.id).update_all(source_bytes: JSON.generate(dataset.source).bytesize)
        end
      end
    end
  end
end
