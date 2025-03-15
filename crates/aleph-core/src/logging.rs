use {
    fern,
    log::info,
    std::{env, str::FromStr, time::SystemTime},
    tracing,
    tracing_subscriber::{self, fmt::{self, format::PrettyFields}},
};

pub fn setup_telemetry() {
    tracing_subscriber::fmt()
        .compact()
        .with_max_level(tracing::Level::TRACE)
        .init();
}

pub fn setup_logger() -> Result<(), fern::InitError> {
    let log_level = {
        let level = env::var("RUST_LOG").unwrap_or("info".to_string());
        let level = log::Level::from_str(&level).unwrap_or_else(|_| {
            eprintln!("Invalid RUST_LOG value: {}, defaulting to info", level);
            log::Level::Info
        });
        level.to_level_filter()
    };

    fern::Dispatch::new()
        .format(|out, message, record| {
            out.finish(format_args!(
                "[{} {} {}] {}",
                humantime::format_rfc3339_seconds(SystemTime::now()),
                record.level(),
                record.target(),
                message
            ))
        })
        .level(log_level)
        .chain(std::io::stdout())
        .apply()?;

    info!("Logging setup complete");
    Ok(())
}
