use aleph::App;


fn main() -> anyhow::Result<()> {
    App::default().run().map_err(|err| anyhow::anyhow!(err))
}
