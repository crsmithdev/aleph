pub use tracing::{debug, error, info, trace, warn};
use {
    tracing,
    tracing_subscriber::{self, fmt::format::Writer, EnvFilter},
};

struct Timer {}

impl tracing_subscriber::fmt::time::FormatTime for Timer {
    fn format_time(&self, writer: &mut Writer<'_>) -> std::fmt::Result {
        let time = chrono::Utc::now();
        writer.write_str(&format!("{}", time.format("%Y-%m-%d %H:%M:%S")))
    }
}

pub fn setup_logging() {
    let format = tracing_subscriber::fmt::format()
        .with_timer(Timer {})
        .with_thread_ids(false)
        .with_thread_names(false)
        .with_level(true)
        .with_ansi(false)
        .with_target(true)
        .with_file(true)
        .with_line_number(true)
        .pretty();  
    tracing_subscriber::fmt()
        .event_format(format)
        .with_env_filter(EnvFilter::from_default_env())
        .init();
}
