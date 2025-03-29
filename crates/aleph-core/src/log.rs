pub use tracing::{debug, error, info, trace, warn};
use tracing_subscriber::fmt::format::Writer;
use {
    tracing,
    tracing_subscriber::{self, EnvFilter},
};

struct Timer {}
impl tracing_subscriber::fmt::time::FormatTime for Timer {
    fn format_time(&self, w: &mut Writer<'_>) -> std::fmt::Result {
        let t = chrono::Utc::now();
        w.write_str(&format!("{}", t.format("%Y-%m-%d %H:%M:%S")))
    }
}

pub fn setup() {
    let format = tracing_subscriber::fmt::format()
        .with_timer(Timer {})
        .with_thread_ids(false)
        .with_thread_names(false)
        .with_level(true)
        .with_target(false)
        .compact();
    tracing_subscriber::fmt()
        .event_format(format)
        .with_env_filter(EnvFilter::from_default_env())
        .init();
}