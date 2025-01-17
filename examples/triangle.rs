use {aleph::App, aleph_app::app::AppConfig};

fn main() {
    let config = AppConfig::default().name("Triangle");
    App::new(config).run();
}
