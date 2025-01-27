use {aleph::prelude::*, anyhow::Result};

fn main() -> Result<()> {
    let config = AppConfig::default().name("Triangle");
    App::new(config)
        .with_layer(UpdateLayer::default())
        .with_layer(GraphicsLayer::default())
        .run()
}
