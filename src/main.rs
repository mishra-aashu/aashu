#[tokio::main]
async fn main() -> anyhow::Result<()> {
    aashu_backend::start_server().await?;
    Ok(())
}
