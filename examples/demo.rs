use aleph::prelude::*;
use aleph_core::Layer;

fn main() {
    let config = AppConfig::default().name("Demo");
    App::new(config)
        .with_layer(UpdateLayer::default())
        .with_layer(GraphicsLayer::default())
        .run().expect("Error running demo"); 
}
